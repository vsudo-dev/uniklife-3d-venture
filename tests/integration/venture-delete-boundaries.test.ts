import {beforeAll,afterAll,describe,it,expect} from "vitest";
import type {Database} from "@/lib/db/types";
import type {AuthContext} from "@/lib/auth/context";
import {createTestDb,ctxFor,demoVenture} from "../support/db";
import {deleteVenture,getVenture,listVentures} from "@/lib/services/ventures";
import {previewPlotCsvImport,applyPlotCsvImport,listPlots} from "@/lib/services/plots";
let db:Database,ctx:AuthContext,ventureId:string;
beforeAll(async()=>{db=await createTestDb();ctx=await ctxFor(db,"ceo@demo.local");ventureId=(await demoVenture(db)).id;});
afterAll(async()=>{await db.close();});
describe("boundary inventory and direct venture deletion",()=>{
 it("imports each named boundary as its own dimension",async()=>{const csv="plot_number,area_sq_yards,base_price_per_sq_yard,north_ft,south_ft,east_ft,west_ft\nBOUNDARY-1,147,1000,40,39,33,32";const preview=await previewPlotCsvImport(ctx,{ventureId,csv});expect(preview.summary.create).toBe(1);await applyPlotCsvImport(ctx,{ventureId,csv});const [p]=await db.query<Record<string,unknown>>("select north_ft,south_ft,east_ft,west_ft from plots where venture_id=$1 and plot_number='BOUNDARY-1'",[ventureId]);expect(Number(p.north_ft)).toBe(40);expect(Number(p.west_ft)).toBe(32);});
 it("requires delete permission and correct organization",async()=>{const sales=await ctxFor(db,"anil@demo.local");await expect(deleteVenture(sales,ventureId)).rejects.toMatchObject({status:403});const other=await ctxFor(db,"admin@sample-b.local");await expect(deleteVenture(other,ventureId)).rejects.toMatchObject({status:404});});
 it("deletes without an approval request and retains source/history rows",async()=>{const [before]=await db.query<{n:number}>("select count(*)::int as n from plots where venture_id=$1",[ventureId]);await deleteVenture(ctx,ventureId);expect((await listVentures(ctx)).some(v=>v.id===ventureId)).toBe(false);await expect(getVenture(ctx,ventureId)).rejects.toMatchObject({status:404});const [after]=await db.query<{n:number}>("select count(*)::int as n from plots where venture_id=$1",[ventureId]);expect(after.n).toBe(before.n);const visible=await listPlots(ctx,{ventureId});expect(visible.rows.length).toBe(0);await expect(deleteVenture(ctx,ventureId)).resolves.toEqual({deleted:true});});
});
