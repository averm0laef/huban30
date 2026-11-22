import { describe,expect,it } from "vitest";
import { reefParts } from "./reef-part-normalize.js";

describe("external catalog projection",()=>{
  it("strips source URLs, foreign prices/stock, IDs and metadata before any cache or response",()=>{
    expect(reefParts({meta:{source:"supplier"},data:{parts:[{
      article_number:" W 914/2 ",brand:"MANN-FILTER",title:"Фильтр масляный",article_id:"secret-id",url:"https://supplier.example/item",
      image:"https://supplier.example/img",price:10.99,currency:"GBP",units_left:1942,in_stock:true,
    }]}})).toEqual([{article:"W 914/2",brand:"MANN-FILTER",name:"Фильтр масляный"}]);
  });
  it("deduplicates punctuation variants by article AND brand and never by number alone",()=>{
    expect(reefParts({data:{parts:[
      {article_number:"W 914/2",brand:"MANN",title:"one"},
      {article_number:"w914-2",brand:"MANN",title:"two"},
      {article_number:"W914/2",brand:"OTHER",title:"different identity"},
    ]}})).toHaveLength(2);
  });
  it("ignores malformed rows and caps untrusted provider output",()=>{
    const rows=Array.from({length:100},(_,i)=>({article_number:`PART${i}`,brand:"MANN",title:"Part"}));
    expect(reefParts({data:{parts:rows}})).toHaveLength(20);
    expect(reefParts({data:{parts:[null,{}, {article_number:123,brand:"brand"},{article_number:"123",brand:"bad\nvalue"}]}})).toEqual([]);
  });
});
