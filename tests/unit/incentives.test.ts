import {describe,expect,it} from "vitest";
import {calculateIncentive,defaultIncentive,incentiveSchema} from "@/lib/commissions/incentives";
describe("employee incentive policy",()=>{
 it("pays 2% on all plots only after exceeding a target of one",()=>{const p=defaultIncentive("employee");expect(calculateIncentive(p,8,[{netPaise:100000000}]).payoutPaise).toBe(0);expect(calculateIncentive(p,8,[{netPaise:100000000},{netPaise:200000000}]).payoutPaise).toBe(6000000);});
 it("supports fixed rupees per plot and excess-only scope",()=>{const p=defaultIncentive("employee");p.basis="fixed_amount";p.payoutScope="excess_only";p.levels.forEach(l=>l.rate=5000);expect(calculateIncentive(p,4,Array.from({length:3},()=>({netPaise:100000000}))).payoutPaise).toBe(1000000);});
 it("applies a disjoint volume band instead of multiplying all level rates",()=>{const p=defaultIncentive("employee");p.slabs=[{from:2,to:4,rate:2},{from:5,to:7,rate:3},{from:8,to:null,rate:4}];expect(calculateIncentive(p,1,Array.from({length:5},()=>({netPaise:100000000}))).payoutPaise).toBe(15000000);});
 it("rejects overlaps, missing levels, invalid money and excessive percentages",()=>{const p=defaultIncentive("employee");p.slabs=[{from:2,to:5,rate:2},{from:5,to:7,rate:3}];expect(incentiveSchema.safeParse(p).success).toBe(false);p.slabs=[];p.levels[1].level=1;expect(incentiveSchema.safeParse(p).success).toBe(false);expect(()=>calculateIncentive(defaultIncentive("employee"),8,[{netPaise:-1}])).toThrow();const q=defaultIncentive("employee");q.levels[0].rate=101;expect(incentiveSchema.safeParse(q).success).toBe(false);});
 it("keeps agent defaults independent and inactive at zero rates",()=>{expect(defaultIncentive("agent").levels.every(l=>l.rate===0)).toBe(true);});
});
