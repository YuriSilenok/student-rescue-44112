export type Debt = { id:number; name:string; note:string; done:boolean; idFromRasp?:boolean };
export type Lesson = { id:number; start:string; end:string; date:string; title:string; teacher:string; teacherId:number; group:string; room:string; subgroups:number[]; subgroupUnknown:boolean; changed:boolean; special:boolean };
export type Schedule = { lessons:Lesson[]; stale:boolean; updated:string|null; source:string; fetchedAt:string };
export type TeacherGap = { teacher:Debt; start:number; end:number; previous:Lesson[]; next:Lesson[]; available:[number,number][] };
export type CombinedPeriod = { start:string; end:string; date:string; own:Lesson[] };
export const minutes=(s:string)=>Number(s.slice(11,13))*60+Number(s.slice(14,16));

// KSU's lesson periods, excluding the short breaks and lunch.
// Further periods (for example evening classes) can be learned from actual schedules.
const STANDARD_PERIODS:[number,number][]=[
  [510,600],[610,700],[710,800],[840,930],[940,1030],[1040,1130]
];
export function teachingPeriods(teachers:Record<number,Schedule>,own:Lesson[]):[number,number][]{
  const intervals=[...STANDARD_PERIODS];
  const all=[...own,...Object.values(teachers).flatMap(s=>s.lessons)];
  for(const lesson of all){
    const start=minutes(lesson.start),end=minutes(lesson.end);
    // Only add actual full-length periods outside the established daytime grid.
    if(end-start===90&&(end<=510||start>=1130))intervals.push([start,end]);
  }
  return [...new Map(intervals.map(p=>[p.join('-'),p])).values()].sort((a,b)=>a[0]-b[0]);
}

export function combinedSchedule(own:Lesson[],teachers:Record<number,Schedule>,debts:Debt[]):CombinedPeriod[]{
  const periods=new Map<string,CombinedPeriod>();
  const add=(lesson:Lesson,student:boolean)=>{
    if(lesson.end<=lesson.start)return;
    const key=lesson.start+'|'+lesson.end;
    let period=periods.get(key);
    if(!period){period={start:lesson.start,end:lesson.end,date:lesson.date,own:[]};periods.set(key,period);}
    if(student)period.own.push(lesson);
  };
  own.forEach(l=>add(l,true));
  debts.filter(d=>!d.done).forEach(d=>(teachers[d.id]?.lessons||[]).forEach(l=>add(l,false)));
  return [...periods.values()].map(period=>({...period,
    own:own.filter(l=>l.date===period.date&&l.start<period.end&&l.end>period.start)
  })).sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end));
}

// Subtract only the student's actual classes; travel time is the student's decision.
export function freeSegments(start:number,end:number,own:Lesson[],day:string,periods:[number,number][]=STANDARD_PERIODS):[number,number][]{
  let segments:[number,number][]=periods.map(([a,b]):[number,number]=>[Math.max(a,start),Math.min(b,end)]).filter(([a,b])=>b>a);
  for(const lesson of own.filter(l=>l.date===day)){
    const a=minutes(lesson.start),b=minutes(lesson.end);
    segments=segments.flatMap(([s,e]):[number,number][]=>e<=a||s>=b?[[s,e]]:[[s,Math.min(e,a)],[Math.max(s,b),e]].filter(([x,y])=>y>x) as [number,number][]);
  }
  return segments.filter(([s,e])=>e-s>=10);
}

export function teacherGaps(teachers:Record<number,Schedule>,debts:Debt[],own:Lesson[],day:string):TeacherGap[]{
  const result:TeacherGap[]=[];
  const periods=teachingPeriods(teachers,own);
  for(const teacher of debts.filter(d=>!d.done)){
    // Union simultaneous and overlapping classes first: a duplicate stream must not create a false gap.
    const rows=(teachers[teacher.id]?.lessons||[]).filter(l=>l.date===day).sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end));
    const blocks:{start:number;end:number;first:Lesson[];last:Lesson[]}[]=[];
    for(const lesson of rows){
      const start=minutes(lesson.start),end=minutes(lesson.end);
      if(end<=start)continue;
      const last=blocks[blocks.length-1];
      if(!last||start>last.end)blocks.push({start,end,first:[lesson],last:[lesson]});
      else{
        if(start===last.start)last.first.push(lesson);
        if(end>last.end){last.end=end;last.last=[lesson];}
        else if(end===last.end)last.last.push(lesson);
      }
    }
    for(let i=1;i<blocks.length;i++){
      const before=blocks[i-1],after=blocks[i];
      // Ordinary short breaks and the lunch break are not advertised as a teacher's window.
      if(after.start-before.end<60)continue;
      result.push({teacher,start:before.end,end:after.start,previous:before.last,next:after.first,
        available:freeSegments(before.end,after.start,own,day,periods)});
    }
  }
  return result.sort((a,b)=>a.start-b.start||a.teacher.name.localeCompare(b.teacher.name));
}
