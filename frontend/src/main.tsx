import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, ExternalLink, GraduationCap, LoaderCircle, MapPin, Plus, RefreshCw, Search, Settings2, Trash2, Users, X, WifiOff, ArrowUpRight, HeartHandshake, BookOpen, Menu } from 'lucide-react';
import { combinedSchedule, freeSegments, teacherGaps, teachingPeriods, type CombinedPeriod, type Debt, type Lesson, type Schedule, type TeacherGap } from './planner';
import './style.css';
import './comparison.css';
import './compact.css';

type Person = { id:number; name:string; idFromRasp?:boolean };
type Catalog = { year:string; years:string[]; groups:Person[]; teachers:Person[]; stale:boolean };
type Profile = { group:Person|null; subgroup:string; debts:Debt[]; year:string };
type Slot = { teacher:Debt; lesson:Lesson; start:number; end:number; conflict:boolean };
const STORAGE='student-rescue-profile-v1';
const mosDate=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date());
const fromISO=(s:string)=>new Date(s+'T12:00:00');
const iso=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const move=(s:string,n:number)=>{ const d=fromISO(s); d.setDate(d.getDate()+n); return iso(d); };
const monday=(s:string)=>move(s,-((fromISO(s).getDay()+6)%7));
const mins=(s:string)=>Number(s.slice(11,13))*60+Number(s.slice(14,16));
const hm=(n:number)=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const time=(s:string)=>s.slice(11,16);
const dateLabel=(s:string,opts:Intl.DateTimeFormatOptions={day:'numeric',month:'long'})=>fromISO(s).toLocaleDateString('ru-RU',opts);
const empty:Profile={group:null,subgroup:'2',debts:[],year:''};
function readProfile():Profile { try {const p=JSON.parse(localStorage.getItem(STORAGE)||'null');return p&&Array.isArray(p.debts)?{group:p.group??null,subgroup:p.subgroup??'2',debts:p.debts,year:p.year??''}:empty;}catch{return empty;} }
async function api<T>(path:string, signal?:AbortSignal):Promise<T>{
  const response=await fetch('/api/'+path,{signal});
  if(!response.ok){let message='Не удалось получить расписание';try{message=(await response.json()).detail||message;}catch{}throw Error(message);}
  return response.json();
}
function schedulePath(kind:string,id:number,week:string,year:string){return `schedule?${new URLSearchParams({kind,id:String(id),start:week,year})}`;}
function belongs(l:Lesson,subgroup:string){return subgroup==='all'||!l.subgroups.length||l.subgroups.includes(Number(subgroup));}

function opportunities(teachers:Record<number,Schedule>,debts:Debt[],own:Lesson[],day:string):Slot[]{
  const result:Slot[]=[];
  const periods=teachingPeriods(teachers,own);
  for(const teacher of debts.filter(d=>!d.done)){
    const seen=new Set<string>();
    for(const lesson of teachers[teacher.id]?.lessons||[]){
      if(lesson.date!==day)continue;
      const key=lesson.start+lesson.end+lesson.room;
      if(seen.has(key))continue;seen.add(key);
      const a=mins(lesson.start),b=mins(lesson.end);
      const good=freeSegments(a,b,own,day,periods);
      if(good.length)for(const [start,end] of good)result.push({teacher,lesson,start,end,conflict:false});
      else result.push({teacher,lesson,start:a,end:b,conflict:true});
    }
  }
  return result.sort((a,b)=>a.start-b.start||a.teacher.name.localeCompare(b.teacher.name));
}

const teacherSource=(teacher:Debt)=>`https://eios.kosgos.ru/WebApp/#/Rasp/${teacher.idFromRasp?'Prepod':'Teacher'}/${teacher.id}`;
const roomList=(lessons:Lesson[])=>[...new Set(lessons.map(l=>l.room).filter(Boolean))].join(', ')||'не указана';

function TeacherComparison({period,teachers,debts}:{period:CombinedPeriod;teachers:Record<number,Schedule>;debts:Debt[]}){
  const start=mins(period.start),end=mins(period.end);
  const teaching=debts.filter(d=>!d.done).map(teacher=>({teacher,lessons:(teachers[teacher.id]?.lessons||[]).filter(l=>l.date===period.date&&mins(l.start)<end&&mins(l.end)>start)})).filter(item=>item.lessons.length>0);
  if(!teaching.length)return null;
  return <details className="lesson-extra"><summary><span><Users size={16}/>Преподаватели в это время<span className="comparison-count">{teaching.length}</span></span><ChevronDown size={17}/></summary><div className="lesson-extra-body">{teaching.map(({teacher,lessons})=><section className="teacher-comparison" key={teacher.id}><div className="comparison-heading"><strong>{teacher.name}</strong><a href={teacherSource(teacher)} target="_blank" rel="noreferrer" aria-label={`Исходное расписание: ${teacher.name}`}><ExternalLink size={14}/></a></div>{teacher.note&&<p className="comparison-note">{teacher.note}</p>}{lessons.map((l,i)=><div className="comparison-class" key={`${l.id}-${i}`}><div><span className="comparison-badge">Ведёт занятие</span><span className="room"><MapPin size={14}/>{l.room||'Аудитория не указана'}</span></div><p>{l.title}</p><small>{l.group}</small></div>)}</section>)}</div></details>;
}

function CombinedTimeline({periods,teachers,debts}:{periods:CombinedPeriod[];teachers:Record<number,Schedule>;debts:Debt[]}){
  if(!periods.length)return <div className="empty-state"><CalendarDays size={32}/><h3>На этот день занятий нет</h3><p>В загруженных расписаниях вашей группы и выбранных преподавателей пары не найдены.</p></div>;
  return <div className="timeline">{periods.map(period=><article className="lesson-row" key={period.start+'|'+period.end}><div className="lesson-time"><strong>{time(period.start)}</strong><span>{time(period.end)}</span></div><div className="timeline-track"><span/></div><div className={`lesson-card ${period.own.length?'':'teacher-only-period'}`}>
    {period.own.length?period.own.map((lesson,i)=><div className="student-period-class" key={`${lesson.id}-${i}`}><div className="lesson-meta"><span className={`lesson-kind ${lesson.title.startsWith('лек')?'lecture':''}`}>{lesson.title.startsWith('лек')?'Лекция':lesson.title.startsWith('лаб')?'Лабораторная':'Практика'}</span>{lesson.subgroups.length>0&&<span>{lesson.subgroups.join(', ')} подгруппа</span>}{lesson.changed&&<span className="changed">Замена</span>}{(lesson.start!==period.start||lesson.end!==period.end)&&<span>{time(lesson.start)}–{time(lesson.end)}</span>}</div><h3>{lesson.title.replace(/^(лек|лаб|пр)\s+/,'').replace(/,?\s*п\/г\s*\d+/g,'')}</h3><div className="lesson-bottom"><span><Users size={15}/>{lesson.teacher||'Преподаватель не указан'}</span><span><MapPin size={15}/>{lesson.room||'Аудитория не указана'}</span></div>{lesson.subgroupUnknown&&<p className="small-error">Уточните подгруппу в исходном расписании: {lesson.title}</p>}</div>):<><div className="lesson-meta"><span className="lesson-kind lecture">У вас нет пары</span></div></>}
    <TeacherComparison period={period} teachers={teachers} debts={debts}/>
  </div></article>)}</div>;
}

function TeacherWindow({gap}:{gap:TeacherGap}){
  return <article className={`teacher-window ${gap.available.length?'shared-window':''}`}><div className="window-heading"><div className="window-icon"><Clock3 size={19}/></div><div><span className="window-label">ОКНО ПРЕПОДАВАТЕЛЯ</span><h4>{gap.teacher.name}</h4></div><span className="window-time">{hm(gap.start)}–{hm(gap.end)}<small>{gap.end-gap.start} мин</small></span></div>{gap.teacher.note&&<p className="window-note">{gap.teacher.note}</p>}<div className={`shared-time ${gap.available.length?'':'no-shared-time'}`}><strong>{gap.available.length?'Вы свободны в часы занятий':'Нет общего свободного времени в часы занятий'}</strong>{gap.available.length>0&&<span>{gap.available.map(([s,e])=>`${hm(s)}–${hm(e)}`).join(', ')}</span>}</div><div className="window-rooms"><span>До окна: <strong>{roomList(gap.previous)}</strong></span><span>После окна: <strong>{roomList(gap.next)}</strong></span></div><p className="window-location-note">Аудитория во время окна неизвестна. Договоритесь, где встретиться.</p><details className="window-context"><summary>Занятия до и после окна</summary><p><strong>До:</strong> {gap.previous.map(l=>`${time(l.start)}–${time(l.end)} · ${l.title} · ${l.group}`).join('; ')}</p><p><strong>После:</strong> {gap.next.map(l=>`${time(l.start)}–${time(l.end)} · ${l.title} · ${l.group}`).join('; ')}</p><a href={teacherSource(gap.teacher)} target="_blank" rel="noreferrer">Исходное расписание<ExternalLink size={13}/></a></details></article>;
}

function Picker({items,placeholder,onPick}:{items:Person[];placeholder:string;onPick:(p:Person)=>void}){
  const [query,setQuery]=useState('');const [open,setOpen]=useState(false);
  const matches=items.filter(p=>p.name.toLocaleLowerCase().replace(/\s+/g,' ').includes(query.toLocaleLowerCase().trim())).slice(0,30);
  return <div className="picker"><div className="search-input"><Search size={18}/><input aria-label={placeholder} placeholder={placeholder} value={query} onFocus={()=>setOpen(true)} onChange={e=>{setQuery(e.target.value);setOpen(true);}} onKeyDown={e=>{if(e.key==='Escape')setOpen(false);if(e.key==='Enter'&&matches.length===1){onPick(matches[0]);setQuery('');setOpen(false);}}}/>{query&&<button className="icon-button" aria-label="Очистить поиск" onClick={()=>setQuery('')}><X size={16}/></button>}</div>{open&&<><button className="picker-dismiss" aria-label="Закрыть поиск" onClick={()=>setOpen(false)}/><div className="picker-results" role="listbox">{matches.map(p=><button key={p.id} onClick={()=>{onPick(p);setQuery('');setOpen(false);}}>{p.name.replace(/\s+/g,' ')}<Plus size={16}/></button>)}{!matches.length&&<p>Ничего не найдено</p>}{matches.length===30&&<p>Уточните запрос, чтобы увидеть нужный вариант</p>}</div></>}</div>;
}

function App(){
  const [profile,setProfile]=useState<Profile>(readProfile);
  const [catalog,setCatalog]=useState<Catalog|null>(null);
  const [catalogError,setCatalogError]=useState('');
  const [catalogTick,setCatalogTick]=useState(0);
  const [day,setDay]=useState(mosDate);
  const [view,setView]=useState<'schedule'|'opportunities'>('schedule');
  const [ownData,setOwnData]=useState<Schedule|null>(null);
  const [teachers,setTeachers]=useState<Record<number,Schedule>>({});
  const [errors,setErrors]=useState<string[]>([]);
  const [loading,setLoading]=useState(false);
  const [refresh,setRefresh]=useState(0);
  const [settings,setSettings]=useState(!profile.group);
  const [mobile,setMobile]=useState(false);
  const [online,setOnline]=useState(navigator.onLine);
  const [saveError,setSaveError]=useState(false);
  const [install,setInstall]=useState<any>(null);
  const sequence=useRef(0);
  const week=monday(day);
  const active=profile.debts.filter(d=>!d.done);
  const teacherKey=active.map(d=>d.id).sort((a,b)=>a-b).join(',');
  const patch=(p:Partial<Profile>)=>setProfile(old=>({...old,...p}));

  useEffect(()=>{try{localStorage.setItem(STORAGE,JSON.stringify(profile));setSaveError(false);}catch{setSaveError(true);}},[profile]);
  useEffect(()=>{const up=()=>setOnline(true),down=()=>setOnline(false),prompt=(e:Event)=>{e.preventDefault();setInstall(e);};window.addEventListener('online',up);window.addEventListener('offline',down);window.addEventListener('beforeinstallprompt',prompt);return()=>{window.removeEventListener('online',up);window.removeEventListener('offline',down);window.removeEventListener('beforeinstallprompt',prompt);};},[]);
  useEffect(()=>{const timer=setInterval(()=>setRefresh(n=>n+1),300000);const focus=()=>setRefresh(n=>n+1);window.addEventListener('focus',focus);return()=>{clearInterval(timer);window.removeEventListener('focus',focus);};},[]);
  useEffect(()=>{const controller=new AbortController();setCatalogError('');api<Catalog>('catalog'+(profile.year?'?year='+encodeURIComponent(profile.year):''),controller.signal).then(c=>{setCatalog(c);if(!profile.year)patch({year:c.year});}).catch(e=>{if(e.name!=='AbortError')setCatalogError(e.message);});return()=>controller.abort();},[profile.year,catalogTick]);
  useEffect(()=>{
    const controller=new AbortController();const seq=++sequence.current;
    if(!profile.group||!profile.year){setOwnData(null);return;}
    setLoading(true);setErrors([]);setOwnData(null);setTeachers({});
    const groupId=profile.group.id,year=profile.year;
    async function load(){
      const ids=teacherKey?teacherKey.split(',').map(Number):[];
      const requests=[api<Schedule>(schedulePath('group',groupId,week,year),controller.signal),...ids.map(id=>api<Schedule>(schedulePath(active.find(d=>d.id===id)?.idFromRasp?'prepod':'teacher',id,week,year),controller.signal))];
      const results=await Promise.allSettled(requests);
      if(seq!==sequence.current||controller.signal.aborted)return;
      const problems:string[]=[];const found:Record<number,Schedule>={};
      results.forEach((r,i)=>{if(r.status==='fulfilled'){if(i===0)setOwnData(r.value);else found[ids[i-1]]=r.value;}else{const label=i===0?'Ваша группа':active.find(d=>d.id===ids[i-1])?.name||'Преподаватель';problems.push(`${label}: ${r.reason.message}`);}});
      setTeachers(found);setErrors(problems);setLoading(false);
    }
    load();return()=>controller.abort();
  },[profile.group?.id,profile.year,week,teacherKey,refresh]);

  const own=(ownData?.lessons||[]).filter(l=>belongs(l,profile.subgroup)).sort((a,b)=>a.start.localeCompare(b.start));
  const lessons=own.filter(l=>l.date===day);
  const combined=combinedSchedule(own,teachers,profile.debts);
  const periods=combined.filter(p=>p.date===day);
  const slots=ownData?opportunities(teachers,profile.debts,own,day):[];
  const available=slots.filter(s=>!s.conflict);
  const gaps=teacherGaps(teachers,profile.debts,own,day);
  const sharedGaps=gaps.filter(g=>g.available.length>0);
  const opportunityCount=available.length+sharedGaps.length;
  const stale=ownData?.stale||Object.values(teachers).some(s=>s.stale)||catalog?.stale;
  const days=Array.from({length:7},(_,i)=>move(week,i));
  const updateDebt=(id:number,data:Partial<Debt>)=>patch({debts:profile.debts.map(d=>d.id===id?{...d,...data}:d)});
  const addTeacher=(p:Person)=>{if(profile.debts.some(d=>d.id===p.id)){updateDebt(p.id,{done:false});return;}patch({debts:[...profile.debts,{id:p.id,name:p.name.replace(/\s+/g,' '),note:'',done:false,idFromRasp:p.idFromRasp}]});};
  const source=profile.group?`https://eios.kosgos.ru/WebApp/#/Rasp/Group/${profile.group.id}`:'https://eios.kosgos.ru/WebApp/#/Rasp/List';
  const renderSlot=(slot:Slot,index:number,compact=false)=><div className={`opportunity ${slot.conflict?'conflict':''} ${compact?'compact':''}`} key={`${slot.teacher.id}-${slot.lesson.id}-${index}`}><div className="op-avatar">{slot.teacher.name.split(' ').slice(0,2).map(s=>s[0]).join('')}</div><div className="op-body"><div className="op-title">{slot.teacher.name}<span className="room"><MapPin size={13}/>{slot.lesson.room||'Аудитория не указана'}</span></div><p>{hm(slot.start)}–{hm(slot.end)} <span>· {slot.conflict?'нет подходящего учебного интервала':'можно подойти по вашему расписанию'}</span></p>{slot.teacher.note&&<p className="op-note">{slot.teacher.note}</p>}{!compact&&<details><summary>Какое занятие у преподавателя</summary><p>{slot.lesson.title}<br/>{slot.lesson.group}</p><a href={`https://eios.kosgos.ru/WebApp/#/Rasp/${slot.teacher.idFromRasp?'Prepod':'Teacher'}/${slot.teacher.id}`} target="_blank" rel="noreferrer">Исходное расписание <ExternalLink size={13}/></a></details>}</div></div>;

  return <div className="app-shell"><aside className={`sidebar ${mobile?'mobile-open':''}`}><div className="brand"><div className="brand-mark"><Plus size={25} strokeWidth={3}/></div><div>студпомощь<span>44·112 / Кострома</span></div><button className="mobile-close icon-button" aria-label="Закрыть меню" onClick={()=>setMobile(false)}><X/></button></div><div className="sidebar-caption">ВАШ УЧЕБНЫЙ НАВИГАТОР</div><nav><button className={view==='schedule'?'active':''} onClick={()=>{setView('schedule');setMobile(false);}}><CalendarDays size={20}/>Моё расписание</button><button className={view==='opportunities'?'active':''} onClick={()=>{setView('opportunities');setMobile(false);}}><HeartHandshake size={20}/>Когда сдать долги<span className="nav-count">{active.length}</span></button></nav><div className="sidebar-line"/><div className="section-label">МОЙ ПРОФИЛЬ<button className="icon-button" aria-label="Настройки профиля" onClick={()=>setSettings(!settings)}><Settings2 size={16}/></button></div><button className="group-profile" onClick={()=>setSettings(!settings)}><div className="group-icon"><GraduationCap size={22}/></div><div><strong>{profile.group?.name||'Выберите группу'}</strong><span>{profile.subgroup==='all'?'Все подгруппы':`${profile.subgroup} подгруппа`}<span className="bullet">·</span>{profile.year||'КГУ'}</span></div></button>
    {settings&&<div className="profile-settings">{catalogError?<div className="small-error">{catalogError}<button onClick={()=>setCatalogTick(n=>n+1)}>Повторить</button></div>:!catalog?<p className="muted">Загружаем справочники…</p>:<><label>Учебный год<select value={profile.year||catalog.year} onChange={e=>{patch({year:e.target.value,group:null,debts:[]});setCatalog(null);}}>{catalog.years.map(y=><option key={y}>{y}</option>)}</select></label><label>Группа</label><Picker items={catalog.groups} placeholder="Например, 26-ИСбо-5" onPick={group=>{patch({group});setSettings(false);}}/><label>Подгруппа<select value={profile.subgroup} onChange={e=>patch({subgroup:e.target.value})}><option value="1">1 подгруппа</option><option value="2">2 подгруппа</option><option value="3">3 подгруппа</option><option value="4">4 подгруппа</option><option value="all">Все подгруппы</option></select></label></>}</div>}
    <div className="sidebar-line"/><div className="section-label">КОМУ НУЖНО СДАТЬ<span>{active.length}</span></div><p className="sidebar-help">Добавьте преподавателей — найдём время между вашими парами.</p>{catalog&&<Picker items={catalog.teachers} placeholder="Фамилия преподавателя" onPick={addTeacher}/>}
    <div className="debts">{profile.debts.map(d=><div className={`debt ${d.done?'done':''}`} key={d.id}><div className="debt-head"><button className="debt-check" title={d.done?'Вернуть долг':'Отметить сданным'} aria-label={d.done?'Вернуть долг':'Отметить сданным'} onClick={()=>updateDebt(d.id,{done:!d.done})}>{d.done?<Check size={13}/>:<span/>}</button><strong>{d.name}</strong><button className="icon-button delete" aria-label={`Удалить ${d.name}`} onClick={()=>patch({debts:profile.debts.filter(x=>x.id!==d.id)})}><Trash2 size={14}/></button></div><input aria-label={`Что сдать: ${d.name}`} placeholder="Что нужно сдать?" value={d.note} maxLength={200} onChange={e=>updateDebt(d.id,{note:e.target.value})}/></div>)}</div><div className="sidebar-footer"><span className="footer-dot"/>Меньше долгов. Больше спокойствия.<small>Профиль хранится только на этом устройстве.</small></div></aside>
    {mobile&&<button className="mobile-overlay" aria-label="Закрыть меню" onClick={()=>setMobile(false)}/>}
    <main><header className="topbar"><button className="icon-button mobile-menu" aria-label="Открыть меню" onClick={()=>setMobile(true)}><Menu/></button><span className="topbar-path">Личный кабинет <span>/</span> {view==='schedule'?'Расписание':'Сдача долгов'}</span><div className="topbar-actions">{install&&<button className="text-button" onClick={async()=>{await install.prompt();setInstall(null);}}>Установить</button>}<a href={source} target="_blank" rel="noreferrer">Расписание КГУ<ExternalLink size={14}/></a><div className="user-avatar">{profile.group?'Я':'?'}</div></div></header><div className="content"><div className="page-heading"><div><div className="eyebrow">УЧЁБА ПОД КОНТРОЛЕМ</div><h1>{view==='schedule'?'Всё успеется.':'Закроем эти долги.'}</h1><p>{view==='schedule'?'Ваши пары и подходящий момент, чтобы найти преподавателя.':'Свободное время у вас. Занятия у преподавателей. Всё рядом.'}</p></div><button className="refresh-button" disabled={loading} onClick={()=>{setRefresh(n=>n+1);if(!catalog)setCatalogTick(n=>n+1);}}><RefreshCw size={16} className={loading?'spin':''}/><span>Обновить</span></button></div>
    {!online&&<div className="notice"><WifiOff size={18}/>Нет подключения. Для загрузки расписания нужен интернет.</div>}{saveError&&<div className="notice">Браузер не позволяет сохранить профиль. Настройки могут пропасть после закрытия страницы.</div>}{stale&&<div className="notice">Сайт КГУ временно недоступен. Показана сохранённая сервером копия; уточните расписание перед визитом.</div>}{errors.map((error,i)=><div className="notice error" key={i}>{error}</div>)}
    <section className="overview"><div className="overview-primary"><div className="overview-icon"><BookOpen size={22}/></div><div><span>Моя группа</span><strong>{profile.group?.name||'Начнём с вашей группы'}</strong><small>{profile.group?(profile.subgroup==='all'?'Все подгруппы':`${profile.subgroup} подгруппа`)+' · '+profile.year:'Выберите её в профиле слева'}</small></div><span className="overview-decoration">44</span></div><div className="overview-stat"><span>В этот день в плане</span><strong>{loading?'—':lessons.length}<small>{lessons.length===1?'пара':'пар(ы)'}</small></strong><span><Clock3 size={14}/>{lessons.length?`${time(lessons[0].start)} — ${time(lessons[lessons.length-1].end)}`:'День без ваших пар'}</span></div><div className="overview-stat"><span>Возможности для сдачи</span><strong>{loading?'—':opportunityCount}<small>на этот день</small></strong><span className="green-text"><HeartHandshake size={15}/>{active.length?`Ищем ${active.length} преподавателей`:'Добавьте преподавателя'}</span></div></section>
    <section className="schedule-panel"><div className="schedule-toolbar"><div className="view-tabs"><button className={view==='schedule'?'selected':''} onClick={()=>setView('schedule')}>Расписание</button><button className={view==='opportunities'?'selected':''} onClick={()=>setView('opportunities')}>Возможности<span>{opportunityCount}</span></button></div><div className="week-controls"><button className="icon-button" aria-label="Предыдущая неделя" onClick={()=>setDay(move(day,-7))}><ChevronLeft size={19}/></button><span>{dateLabel(week,{day:'numeric',month:'short'})} — {dateLabel(move(week,6),{day:'numeric',month:'short'})}</span><button className="icon-button" aria-label="Следующая неделя" onClick={()=>setDay(move(day,7))}><ChevronRight size={19}/></button><button className="today-button" onClick={()=>setDay(mosDate())}>Сегодня</button><input className="date-input" type="date" aria-label="Выберите дату" value={day} onChange={e=>{if(e.target.value)setDay(e.target.value);}}/></div></div><div className="week-strip">{days.map(d=><button key={d} className={`${d===day?'chosen':''} ${d===mosDate()?'is-today':''}`} onClick={()=>setDay(d)}><span>{dateLabel(d,{weekday:'short'})}</span><strong>{fromISO(d).getDate()}</strong><i className={combined.some(p=>p.date===d)?'has-lessons':''}/></button>)}</div><div className="day-heading"><h2>{dateLabel(day,{weekday:'long',day:'numeric',month:'long'})}</h2><span>Время московское</span></div>
    {!profile.group?<div className="empty-state"><GraduationCap size={38}/><h3>Сначала найдём вашу группу</h3><p>Укажите группу и подгруппу, затем добавьте преподавателей, которым нужно сдать работы.</p><button className="primary-button" onClick={()=>{setSettings(true);setMobile(true);}}>Настроить профиль</button></div>:loading?<div className="empty-state"><LoaderCircle className="spin" size={30}/><h3>Собираем ваш учебный день</h3><p>Загружаем расписания группы и преподавателей…</p></div>:!ownData?<div className="empty-state"><WifiOff size={30}/><h3>Не удалось загрузить расписание группы</h3><p>Без него мы не можем определить свободное время.</p><button className="primary-button" onClick={()=>setRefresh(n=>n+1)}>Повторить загрузку</button></div>:view==='opportunities'?<div className="opportunities-view">{!active.length?<div className="empty-state"><Users size={34}/><h3>Кому нужно сдать работу?</h3><p>Добавьте преподавателя в панели слева — покажем его аудитории и подходящее время.</p><button className="primary-button" onClick={()=>setMobile(true)}>Добавить преподавателя</button></div>:<><div className="inline-explanation"><HeartHandshake size={18}/><span>Сопоставляем ваши пары с занятиями и окнами преподавателей. Показываем общие свободные интервалы только в часы занятий, без перемен и обеда. Оцените, успеваете ли вы подойти, и согласуйте сдачу.</span></div><section className="windows-section"><div className="opportunity-section-heading"><h3>Окна преподавателей</h3><span>{gaps.length}</span></div><p className="section-explanation">Перерывы от часа между занятиями в этот день. Короткие перемены, время до первой и после последней пары сюда не включаем.</p>{gaps.length?<>{[...sharedGaps,...gaps.filter(g=>!g.available.length)].map((gap,i)=><TeacherWindow key={`${gap.teacher.id}-${gap.start}-${i}`} gap={gap}/>)}</>:<p className="no-windows">В загруженных расписаниях выбранных преподавателей на этот день окон не найдено.</p>}</section><div className="opportunity-section-heading"><h3>Где преподаватели ведут занятия</h3><span>{available.length}</span></div><p className="section-explanation">Эти занятия совпадают с вашим свободным временем. Аудитория известна, но возможность подойти во время чужой пары нужно согласовать.</p>{available.length?<>{available.map((s,i)=>renderSlot(s,i))}</>:<div className="empty-state"><Clock3 size={30}/><h3>Занятий в ваше свободное время не найдено</h3><p>Проверьте окна преподавателей выше или выберите другой день.</p></div>}{slots.some(s=>s.conflict)&&<details className="conflict-details"><summary>Совпадают с вашими парами ({slots.filter(s=>s.conflict).length})</summary>{slots.filter(s=>s.conflict).map((s,i)=>renderSlot(s,i))}</details>}</>}</div>:<CombinedTimeline periods={periods} teachers={teachers} debts={profile.debts}/>}
    </section><footer className="content-footer"><div><span className="source-dot"/>Данные: ЭИОС КГУ{ownData?.updated&&<> · Обновлены {dateLabel(ownData.updated.slice(0,10),{day:'numeric',month:'short',year:'numeric'})}</>}</div><a href="https://github.com/YuriSilenok/student-rescue-44112" target="_blank" rel="noreferrer">О проекте<ArrowUpRight size={14}/></a></footer><div className="disclaimer">Аудитория указана по расписанию. Это не запись на консультацию и не подтверждение присутствия преподавателя. Перед сдачей договоритесь с ним.</div></div></main></div>;
}

createRoot(document.getElementById('root')!).render(<App/>);
if('serviceWorker' in navigator&&import.meta.env.PROD)window.addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js').catch(()=>{});});
