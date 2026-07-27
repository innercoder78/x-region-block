import { expect, it, vi } from 'vitest';
import { installXAboutAccountRequestCapture } from '../src/page/x-about-account-request-capture.js';
import { X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE } from '../src/shared/x-about-account-request-metadata-event.js';
import { X_ABOUT_ACCOUNT_FALLBACK_QUERY_ID } from '../src/shared/x-about-account-query.js';
import { metadataFacades, observedHeaders } from './helpers/x-request-metadata-facade.js';
const generic = 'https://x.com/i/api/graphql/generic_id/HomeTimeline?variables=%7B%7D';
function listen(document) { const values=[]; document.addEventListener(X_ABOUT_ACCOUNT_REQUEST_METADATA_EVENT_TYPE,e=>values.push(JSON.parse(e.detail))); return values; }
it('captures generic fetch authentication with fallback without changing the call', () => {
 const fetch=vi.fn(()=> 'result'); const {page,document}=metadataFacades(fetch); const values=listen(document); const capture=installXAboutAccountRequestCapture(page);
 expect(page.fetch(generic,{headers:observedHeaders})).toBe('result'); expect(fetch).toHaveBeenCalledTimes(1); expect(values[0].queryId).toBe(X_ABOUT_ACCOUNT_FALLBACK_QUERY_ID); expect(Object.keys(values[0])).toEqual(['version','origin','queryId','headers']); capture.stop(); expect(page.fetch).toBe(fetch);
});
it('supports Request headers and prefers a live About Account query ID', () => {
 const {page,document}=metadataFacades(()=>null); const values=listen(document); installXAboutAccountRequestCapture(page);
 page.fetch(new Request('https://x.com/i/api/graphql/live_123/AboutAccountQuery?variables=%7B%7D',{headers:observedHeaders}));
 expect(values[0].queryId).toBe('live_123');
});
it('ignores ineligible and missing authentication requests', () => {
 const fetch=vi.fn(); const {page}=metadataFacades(fetch); const capture=installXAboutAccountRequestCapture(page);
 for(const url of ['https://evil.test/i/api/graphql/id/Op?x=1','https://x.com/not/graphql','https://x.com/i/api/graphql/../id/Op?x=1']) page.fetch(url,{headers:observedHeaders});
 page.fetch(generic,{headers:{authorization:'a'}}); expect(capture.hasSnapshot()).toBe(false); expect(fetch).toHaveBeenCalledTimes(4);
});
it('passively observes XHR and restores only owned wrappers', () => {
 class XHR { open(...args){this.openArgs=args; return 7;} setRequestHeader(...args){this.headerArgs=args; return 8;} send(...args){this.sendArgs=args; return 9;} }
 const original={open:XHR.prototype.open,setRequestHeader:XHR.prototype.setRequestHeader,send:XHR.prototype.send};
 const {page,document}=metadataFacades(()=>null); page.XMLHttpRequest=XHR; const values=listen(document); const capture=installXAboutAccountRequestCapture(page); const xhr=new XHR();
 expect(xhr.open('GET',generic)).toBe(7); expect(xhr.setRequestHeader('authorization','Bearer x')).toBe(8); xhr.setRequestHeader('x-csrf-token','csrf'); expect(xhr.send('body')).toBe(9); expect(values[0].queryId).toBe(X_ABOUT_ACCOUNT_FALLBACK_QUERY_ID);
 XHR.prototype.open=()=>99; capture.stop(); expect(XHR.prototype.open).not.toBe(original.open); expect(XHR.prototype.setRequestHeader).toBe(original.setRequestHeader); expect(XHR.prototype.send).toBe(original.send);
});
