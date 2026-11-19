export const BOOKING_DRAFT_KEY='cultiva-cart-booking-draft-v1';
const lifetime=7*24*60*60*1000;
export type BookingDraft={packageId:string;selected:string;step:1|2|3;guests:string;eventType:string;eventTime:string};

export function parseBookingDraft(raw:string|null,now=Date.now()):BookingDraft|null{
 if(!raw)return null;
 try{
  const value=JSON.parse(raw);
  if(!value||value.version!==1||!Number.isFinite(value.savedAt)||value.savedAt>now||now-value.savedAt>lifetime)return null;
  if(typeof value.packageId!=='string'||value.packageId.length>100||typeof value.selected!=='string'||!/^\d{4}-\d{2}-\d{2}$|^$/.test(value.selected))return null;
  if(![1,2,3].includes(value.step)||typeof value.guests!=='string'||!/^\d{0,4}$/.test(value.guests))return null;
  if(typeof value.eventType!=='string'||value.eventType.length>80||typeof value.eventTime!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.eventTime))return null;
  return {packageId:value.packageId,selected:value.selected,step:value.step as 1|2|3,guests:value.guests,eventType:value.eventType,eventTime:value.eventTime};
 }catch{return null}
}

export function serializeBookingDraft(draft:BookingDraft,now=Date.now()){
 return JSON.stringify({version:1,savedAt:now,...draft});
}
