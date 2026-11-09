import {beforeAll,afterAll,describe,it,expect} from "vitest";
import type {Database} from "@/lib/db/types";
import type {AuthContext} from "@/lib/auth/context";
import {createTestDb,ctxFor,demoVenture,key} from "../support/db";
import {placeHold} from "@/lib/services/bookings";
import {applyPlotCsvImport,previewPlotCsvImport,updatePlotMortgage,unblockPlots} from "@/lib/services/plots";
let db:Database,ctx:AuthContext,ventureId:string,plotId:string;
beforeAll(async()=>{db=await createTestDb();ctx=await ctxFor(db,"ceo@demo.local");ventureId=(await demoVenture(db)).id;});
afterAll(async()=>{await db.close();});
describe("mortgage inventory safeguards",()=>{
 it("imports mortgage plots blocked and retains a reference",async()=>{
  await applyPlotCsvImport(ctx,{ventureId,csv:"plot_number,area_sq_yards,base_price_per_sq_yard,is_mortgaged,mortgage_reference\nMORT-1,150,12000,yes,LAYOUT-173"});
  const [p]=await db.query<{id:string;status:string;is_mortgaged:boolean;mortgage_reference:string}>("select * from plots where venture_id=$1 and plot_number='MORT-1'",[ventureId]);plotId=p.id;
  expect(p.status).toBe("blocked");expect(p.is_mortgaged).toBe(true);expect(p.mortgage_reference).toBe("LAYOUT-173");
 });
 it("rejects ordinary unblock and direct status changes",async()=>{
  await expect(unblockPlots(ctx,{plotIds:[plotId],reason:"Attempt ordinary unblock"})).rejects.toMatchObject({status:409});
  await expect(placeHold(ctx,{plotIds:[plotId],customer:{fullName:"Mortgage test buyer",phone:"+919811199999"},idempotencyKey:key("mortgage")})).rejects.toMatchObject({status:409});
  await expect(db.query("update plots set status='available' where id=$1",[plotId])).rejects.toBeTruthy();
 });
 it("CSV cannot clear a mortgage and omission preserves the block",async()=>{
  const preview=await previewPlotCsvImport(ctx,{ventureId,csv:"plot_number,is_mortgaged\nMORT-1,no"});expect(preview.summary.error).toBe(1);
  await applyPlotCsvImport(ctx,{ventureId,csv:"plot_number,base_price_per_sq_yard\nMORT-1,13000"});
  const [p]=await db.query<{is_mortgaged:boolean}>("select is_mortgaged from plots where id=$1",[plotId]);expect(p.is_mortgaged).toBe(true);
 });
 it("requires scoped versioned release and keeps released inventory blocked until reviewed",async()=>{
  const [p]=await db.query<{version:number}>("select version from plots where id=$1",[plotId]);
  const other=await ctxFor(db,"admin@sample-b.local");
  await expect(updatePlotMortgage(other,plotId,{version:p.version,isMortgaged:false,reference:"RELEASE-1",reason:"Verified release"})).rejects.toMatchObject({status:404});
  await expect(updatePlotMortgage(ctx,plotId,{version:p.version,isMortgaged:false,reference:"",reason:"Verified release"})).rejects.toMatchObject({status:400});
  const after=await updatePlotMortgage(ctx,plotId,{version:p.version,isMortgaged:false,reference:"RELEASE-1",reason:"Verified release document"});expect(after.status).toBe("blocked");expect(after.is_mortgaged).toBe(false);
  await unblockPlots(ctx,{plotIds:[plotId],reason:"Selling price reviewed"});
  const [audit]=await db.query<{n:number}>("select count(*)::int as n from audit_logs where entity_id=$1 and action='plot.mortgage_updated'",[plotId]);expect(audit.n).toBe(1);
 });
});
