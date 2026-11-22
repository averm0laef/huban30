import { EventEmitter } from "node:events";
import type { lookup } from "node:dns/promises";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { get } from "node:https";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { isPublicAddress, loadPublicImage } from "./public-image.js";

const png=Buffer.from([137,80,78,71,13,10,26,10,0,0]);
const resolver=(answers:Array<{address:string;family:number}>)=>vi.fn().mockResolvedValue(answers) as unknown as typeof lookup;
function requester(bytes:Buffer=png,options:{status?:number;type?:string;length?:string}={}) {
  const stream=Readable.from([bytes]) as unknown as IncomingMessage;
  stream.statusCode=options.status ?? 200;
  stream.headers={"content-type":options.type ?? "image/png",...(options.length?{"content-length":options.length}:{})};
  const fetch=vi.fn().mockImplementation((_url,_options,callback)=>{
    queueMicrotask(()=>callback(stream));
    return new EventEmitter() as ClientRequest;
  });
  return { fetch:fetch as unknown as typeof get, spy:fetch, stream };
}

describe("safe public photo downloads",()=>{
  it.each(["0.0.0.0","10.1.2.3","100.64.0.1","127.0.0.1","169.254.169.254","172.16.1.1","172.31.255.1","192.168.1.1","192.0.2.1","198.18.1.1","198.51.100.1","203.0.113.1","224.0.0.1","255.255.255.255","::1","::ffff:127.0.0.1","fc00::1","fe80::1","2001:db8::1","2001:0db8::1","2002:7f00:1::1","2::1"])("rejects private, special or non-routable address %s",address=>{
    expect(isPublicAddress(address)).toBe(false);
  });
  it.each(["8.8.8.8","1.1.1.1","93.184.216.34","2606:4700::1111","2001:4860:4860::8888","2a00:1450:4001::1"])("accepts a public address %s",address=>expect(isPublicAddress(address)).toBe(true));
  it("rejects a hostname with even one private DNS answer before any request",async()=>{
    const request=requester();
    await expect(loadPublicImage("https://images.example.com/post.png",resolver([{address:"1.1.1.1",family:4},{address:"10.0.0.2",family:4}]),request.fetch)).rejects.toThrow("image_address_not_public");
    expect(request.spy).not.toHaveBeenCalled();
  });
  it.each(["http://images.example.com/post.png","https://127.0.0.1/post.png","https://user:pass@images.example.com/post.png","https://images.example.com:8443/post.png","https://localhost/post.png","https://metadata.internal/post.png"])("blocks unsafe URL %s before resolution",async url=>{
    const dns=resolver([{address:"1.1.1.1",family:4}]), request=requester();
    await expect(loadPublicImage(url,dns,request.fetch)).rejects.toThrow("invalid_image_url");
    expect(dns).not.toHaveBeenCalled(); expect(request.spy).not.toHaveBeenCalled();
  });
  it("pins the resolved address for TLS and never consults changing DNS a second time",async()=>{
    const dns=resolver([{address:"93.184.216.34",family:4}]),request=requester();
    const result=await loadPublicImage("https://images.example.com/post.png",dns,request.fetch);
    const requestOptions=request.spy.mock.calls[0]?.[1] as {lookup:(host:string,options:{all:boolean},callback:(error:Error|null,answers:unknown)=>void)=>void;agent:boolean;headers:Record<string,string>};
    const resolved=vi.fn(); requestOptions.lookup("images.example.com",{all:true},resolved);
    expect(resolved).toHaveBeenCalledWith(null,[{address:"93.184.216.34",family:4}]);
    expect(dns).toHaveBeenCalledTimes(1);
    expect(requestOptions.agent).toBe(false);
    expect(requestOptions.headers).toEqual({Accept:"image/jpeg,image/png,image/gif"});
    expect(result.mime).toBe("image/png"); expect(Buffer.from(result.bytes)).toEqual(png);
  });
  it("does not follow redirects, including redirects into a private network",async()=>{
    const request=requester(png,{status:302}); request.stream.headers.location="https://127.0.0.1/secrets";
    await expect(loadPublicImage("https://images.example.com/a.png",resolver([{address:"1.1.1.1",family:4}]),request.fetch)).rejects.toThrow("image_download_rejected");
    expect(request.spy).toHaveBeenCalledTimes(1);
    expect(request.stream.destroyed).toBe(true);
  });
  it("rejects SVG/HTML and mismatched MIME even if they masquerade as an image URL",async()=>{
    const dns=resolver([{address:"1.1.1.1",family:4}]);
    await expect(loadPublicImage("https://images.example.com/a.png",dns,requester(Buffer.from("<svg><script/></svg>"),{type:"image/svg+xml"}).fetch)).rejects.toThrow("image_format_not_supported");
    await expect(loadPublicImage("https://images.example.com/a.png",dns,requester(png,{type:"text/html"}).fetch)).rejects.toThrow("image_format_not_supported");
  });
  it("caps downloads using the actual stream, even without a declared size",async()=>{
    const request=requester(Buffer.alloc(8*1024*1024+1));
    await expect(loadPublicImage("https://images.example.com/a.png",resolver([{address:"1.1.1.1",family:4}]),request.fetch)).rejects.toThrow("image_too_large");
    expect(request.stream.destroyed).toBe(true);
  });
  it("rejects declared oversized files before reading",async()=>{
    const request=requester(png,{length:String(8*1024*1024+1)});
    await expect(loadPublicImage("https://images.example.com/a.png",resolver([{address:"1.1.1.1",family:4}]),request.fetch)).rejects.toThrow("image_download_rejected");
  });
});
