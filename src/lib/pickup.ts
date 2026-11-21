import {todayManila,validDate} from './rules';

export type Schedule={weekday:number,enabled:boolean,opensAt:string,closesAt:string,capacity:number};
export const PICKUP_LEAD_MINUTES=30;
export const PICKUP_HORIZON_DAYS=14;

export function pickupWindow(date:string,now=new Date()){
 const first=todayManila(now),last=todayManila(new Date(now.getTime()+PICKUP_HORIZON_DAYS*86400000));
 return validDate(date)&&date>=first&&date<=last;
}
export function weekdayFor(date:string){return new Date(date+'T12:00:00+08:00').getUTCDay()}
export function slotTimes(schedule:Schedule){
 if(!schedule.enabled)return [];
 const minutes=(v:string)=>{const [h,m]=v.split(':').map(Number);return h*60+m};
 const result:string[]=[];
 for(let t=minutes(schedule.opensAt);t+30<=minutes(schedule.closesAt);t+=30)
  result.push(String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0'));
 return result;
}
export function pickupSlots(date:string,schedule:Schedule,counts:Map<string,number>,now=new Date()){
 if(!pickupWindow(date,now))return [];
 return slotTimes(schedule).map(time=>({
  time,remaining:Math.max(0,schedule.capacity-(counts.get(time)||0)),
  available:new Date(date+'T'+time+':00+08:00').getTime()>=now.getTime()+PICKUP_LEAD_MINUTES*60000&&(counts.get(time)||0)<schedule.capacity
 }));
}
