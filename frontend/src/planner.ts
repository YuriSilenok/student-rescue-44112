export type Debt = { id:number; name:string; note:string; done:boolean; idFromRasp?:boolean };
export type Lesson = { id:number; start:string; end:string; date:string; title:string; teacher:string; teacherId:number; group:string; room:string; subgroups:number[]; subgroupUnknown:boolean; changed:boolean; special:boolean };
export type Schedule = { lessons:Lesson[]; stale:boolean; updated:string|null; source:string; fetchedAt:string };
export type TeacherGap = { teacher:Debt; start:number; end:number; previous:Lesson[]; next:Lesson[]; available:[number,number][] };
export const minutes=(s:string)=>Number(s.slice(11,13))*60+Number(s.slice(14,16));

// Subtract the student's occupied intervals, including their travel allowance.
export function freeSegments(start:number,end:number,own:Lesson[],day:string,travel:number):[number,number][]{
  let segments:[number,number][]=[[start,end]];
  for(const lesson of own.filter(l=>l.date===day)){
    const a=minutes(lesson.start)-travel,b=minutes(lesson.end)+travel;
    segments=segments.flatMap(([s,e]):[number,number][]=>e<=a||s>=b?[[s,e]]:[[s,Math.min(e,a)],[Math.max(s,b),e]].filter(([x,y])=>y>x) as [number,number][]);
  }
  return segments.filter(([s,e])=>e-s>=10);
}

export function teacherGaps(teachers:Record<number,Schedule>,debts:Debt[],own:Lesson[],day:string,travel:number):TeacherGap[]{
  const result:TeacherGap[]=[];
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
        available:freeSegments(before.end,after.start,own,day,travel)});
    }
  }
  return result.sort((a,b)=>a.start-b.start||a.teacher.name.localeCompare(b.teacher.name));
}
