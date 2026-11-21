import test from 'node:test';
import assert from 'node:assert/strict';
import {pickupSlots,pickupWindow,slotTimes,weekdayFor} from '../src/lib/pickup';

const saturday={weekday:6,enabled:true,opensAt:'08:00',closesAt:'09:00',capacity:2};

test('Manila weekday, 14-day booking window and closing time',()=>{
 assert.equal(weekdayFor('2026-11-21'),6);
 const now=new Date('2026-11-21T00:00:00Z');
 assert.equal(pickupWindow('2026-11-21',now),true);
 assert.equal(pickupWindow('2026-12-05',now),true);
 assert.equal(pickupWindow('2026-12-06',now),false);
 assert.deepEqual(slotTimes(saturday),['08:00','08:30']);
 assert.deepEqual(slotTimes({...saturday,enabled:false}),[]);
});
test('full slots and lead times never appear available',()=>{
 const date='2026-11-21',counts=new Map([['08:00',2],['08:30',1]]);
 const slots=pickupSlots(date,saturday,counts,new Date('2026-11-20T23:45:00Z'));
 assert.equal(slots[0].available,false);
 assert.equal(slots[0].remaining,0);
 assert.equal(slots[1].available,true);
 assert.equal(slots[1].remaining,1);
});
