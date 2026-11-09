import {authed,body,json} from "@/lib/api";
import {mortgageSchema,updatePlotMortgage} from "@/lib/services/plots";
export const PUT=authed<{id:string}>(async(req,ctx,{id})=>json({plot:await updatePlotMortgage(ctx,id,await body(req,mortgageSchema))}));
