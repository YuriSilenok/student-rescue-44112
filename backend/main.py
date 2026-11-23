import asyncio
import logging
import re
import time
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from typing import Literal

import httpx
from fastapi import FastAPI, HTTPException, Query

log = logging.getLogger('student-rescue')
BASE = 'https://eios.kosgos.ru'
cache = {}
locks = {}
limit = asyncio.Semaphore(6)


@asynccontextmanager
async def lifespan(app):
    app.state.http = httpx.AsyncClient(base_url=BASE, timeout=25, follow_redirects=True)
    yield
    await app.state.http.aclose()


app = FastAPI(title='Студпомощь 44·112', lifespan=lifespan, docs_url=None, redoc_url=None)


async def upstream(path, params=None, ttl=300):
    params = params or {}
    key = (path, tuple(sorted(params.items())))
    async with locks.setdefault(key, asyncio.Lock()):
        saved = cache.get(key)
        if saved and time.monotonic() - saved[0] < ttl:
            return saved[1], False
        try:
            async with limit:
                response = await app.state.http.get(path, params=params)
                response.raise_for_status()
                payload = response.json()
            if payload.get('state') != 1 or 'data' not in payload:
                raise ValueError('Unexpected upstream response')
            data = payload['data']
            if len(cache) > 1500:
                oldest = sorted(cache, key=lambda k: cache[k][0])[:300]
                for old in oldest:
                    cache.pop(old, None)
            cache[key] = (time.monotonic(), data)
            return data, False
        except (httpx.HTTPError, ValueError, TypeError):
            log.warning('Schedule upstream unavailable: %s', path)
            if saved and time.monotonic() - saved[0] < 86400:
                return saved[1], True
            raise HTTPException(502, 'Сайт университета не отвечает. Попробуйте обновить позже.')
        finally:
            # Keep only locks currently used or associated with cached entries.
            for old in list(locks):
                if old != key and old not in cache and not locks[old].locked():
                    locks.pop(old, None)


def normalize(row):
    title = row.get('дисциплина') or ''
    matches = re.findall(r'п\s*/?\s*г\.?\s*(\d+)', title, re.I)
    subgroups = sorted({int(n) for n in matches})
    if not subgroups and row.get('номерПодгруппы', 0):
        subgroups = [int(row['номерПодгруппы'])]
    unknown = bool(re.search(r'подгрупп|п\s*/\s*г', title, re.I)) and not subgroups
    start = row.get('датаНачала')
    end = row.get('датаОкончания')
    if not start or not end:
        return None
    return dict(id=row.get('код'), start=start, end=end, date=start[:10],
                title=title, teacher=row.get('фиоПреподавателя') or row.get('преподаватель') or '',
                teacherId=row.get('кодПреподавателя'), group=row.get('группа') or '',
                room=row.get('аудитория') or '', subgroups=subgroups,
                subgroupUnknown=unknown, changed=bool(row.get('замена')),
                special=bool(row.get('элементГрафика')))


@app.get('/api/health')
async def health():
    return {'status': 'ok'}


@app.get('/api/catalog')
async def catalog(year: str | None = None):
    data, stale = await upstream('/api/Rasp/ListYears', ttl=3600)
    years = sorted(data.get('years', []), reverse=True)
    if not years:
        raise HTTPException(502, 'Справочник учебных лет пока недоступен.')
    selected = year or years[0]
    if selected not in years:
        raise HTTPException(400, 'Неизвестный учебный год')
    (groups, gs), (teachers, ts) = await asyncio.gather(
        upstream('/api/raspGrouplist', {'year': selected}, 3600),
        upstream('/api/raspTeacherlist', {'year': selected}, 3600))
    return dict(year=selected, years=years, groups=groups, teachers=teachers, stale=stale or gs or ts)


@app.get('/api/schedule')
async def schedule(kind: Literal['group', 'teacher', 'prepod'], id: int = Query(gt=0),
                   start: date = Query(), year: str = Query(pattern=r'^\d{4}-\d{4}$')):
    key = {'group': 'idGroup', 'teacher': 'idTeacher', 'prepod': 'idPrepodLine'}[kind]
    data, stale = await upstream('/api/Rasp', {key: id, 'sdate': start.isoformat(), 'year': year})
    rows = [normalize(row) for row in data.get('rasp', [])]
    rows = [row for row in rows if row]
    if data.get('isCyclicalSchedule'):
        raise HTTPException(422, 'Для этого расписания используется циклический формат. Откройте исходное расписание университета.')
    info = data.get('info') or {}
    return dict(lessons=rows, stale=stale, updated=info.get('dateUploadingRasp'),
                source=BASE + f'/WebApp/#/Rasp/{"Group" if kind == "group" else "Prepod" if kind == "prepod" else "Teacher"}/{id}',
                fetchedAt=datetime.now().isoformat())
