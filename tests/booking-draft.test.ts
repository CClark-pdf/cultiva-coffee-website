import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseBookingDraft,serializeBookingDraft} from '../src/lib/booking-draft';

test('booking draft stores only the non-contact choices and expires after seven days',()=>{
 const draft={packageId:'starter',selected:'2026-12-01',step:3 as const,guests:'30',eventType:'Birthday',eventTime:'14:00'};
 const raw=serializeBookingDraft(draft,1_000_000);
 assert.deepEqual(parseBookingDraft(raw,1_000_001),draft);
 assert.equal(raw.includes('phone'),false);
 assert.equal(raw.includes('venue'),false);
 assert.equal(parseBookingDraft(raw,1_000_000+8*24*60*60*1000),null);
 assert.equal(parseBookingDraft('{broken'),null);
});
