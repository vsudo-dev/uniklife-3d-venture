import {describe,it,expect} from "vitest";
import layout from "@/lib/inventory/layouts/sphoorthy-green-nest.json";
describe("reviewed Sphoorthy source manifest",()=>{
 it("contains the complete declared plot number sequence with areas and valid outlines",()=>{expect(layout.plots.map(p=>Number(p.plot_number))).toEqual(Array.from({length:279},(_,i)=>i+1));expect(layout.plots.every(p=>p.area_sq_yards>0&&p.polygon_px.length>=4)).toBe(true);expect(layout.plots.reduce((n,p)=>n+p.area_sq_yards,0)).toBe(layout.printed_plot_area_sum_sq_yards);});
 it("retains the explicit mortgage set and does not invent all boundary lengths",()=>{expect(layout.plots.filter(p=>p.mortgaged).map(p=>Number(p.plot_number))).toEqual([...Array.from({length:6},(_,i)=>173+i),...Array.from({length:29},(_,i)=>251+i)]);expect(layout.plots.some(p=>p.east_ft===null||p.west_ft===null)).toBe(true);});
});
