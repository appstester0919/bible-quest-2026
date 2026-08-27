'use client'

/**
 * ExportButton — PNG export + Web Share for discipline pages.
 *
 * Implementation note (2026-08-27): html-to-image UMD is inlined into the
 * React bundle via a Function constructor. Previous attempts to fetch it
 * from `/vendor/html-to-image.js` were blocked by:
 *   1. CSP `script-src` doesn't include `'unsafe-eval'` for cross-origin
 *      dynamic loaders (esm.sh import)
 *   2. Service worker cache-first `.js` handler intercepting the fetch
 *      inconsistently when SW version mismatches the bundle
 *   3. Browser "Failed to fetch" race when <script> tag injection collides
 *      with route prefetch
 *
 * Inlining + Function() eliminates all three — no network round trip, no
 * SW intercept, no CSP change needed. The UMD bundle (19.5KB) becomes
 * ~20KB extra in the page chunk for /discipline/* only.
 */

import { useState } from 'react'

type HtmlToImage = {
  toPng: (node: HTMLElement, opts?: object) => Promise<string>
  toJpeg?: (node: HTMLElement, opts?: object) => Promise<string>
  toSvg?: (node: HTMLElement, opts?: object) => Promise<string>
}

// ── Inlined html-to-image UMD (v1.11.11, fetched from unpkg 2026-08-27) ──
const HTML_TO_IMAGE_UMD = `!function(t,e){"object"==typeof exports&&"undefined"!=typeof module?e(exports):"function"==typeof define&&define.amd?define(["exports"],e):e((t="undefined"!=typeof globalThis?globalThis:t||self).htmlToImage={})}(this,(function(t){"use strict";function e(t,e,n,r){return new(n||(n=Promise))((function(i,o){function u(t){try{a(r.next(t))}catch(t){o(t)}}function c(t){try{a(r.throw(t))}catch(t){o(t)}}function a(t){var e;t.done?i(t.value):(e=t.value,e instanceof n?e:new n((function(t){t(e)}))).then(u,c)}))}function n(t){var n,r,i,o,u;return e(this,void 0,void 0,(function(){switch(t.label){case 0:return n=a(t),[4,n.canvas];case 1:return r=n.sent(),i=t[0],o=t[1],[4,r.getContext("2d").getImageData(i,o,1,1).data];case 2:return u=n.sent(),[2,[u[0],u[1],u[2],u[3]]]}}))}function r(t,e){return r=Object.setPrototypeOf||{__proto__:[]}instanceof Array&&function(t,e){t.__proto__=e}||function(t,e){for(var n in e)e.hasOwnProperty(n)&&(t[n]=e[n])},r(t,e)}function i(t,e){function n(){this.constructor=t}r(t,e),t.prototype=null===e?Object.create(e):(n.prototype=e.prototype,new n)}var o=function(){function t(t,e){var n,r,i={};for(n in t)Object.prototype.hasOwnProperty.call(t,n)&&(r=t[n],"undefined"!=typeof r&&(i[n]=r));return i}function e(t){var e=t.getBoundingClientRect(),n=t.ownerDocument,r=n.defaultView||n.parentWindow;return{width:e.width,height:e.height,top:e.top,right:e.right,bottom:e.bottom,left:e.left,x:e.left,y:e.top}}function r(t){var n,r={};for(n of t.style)try{r[n]=t.style.getPropertyValue(n)}catch(t){}return r}function i(t,e){return t instanceof HTMLCanvasElement?Promise.resolve(t):"data:"===t.toDataURL().substr(0,5)?Promise.resolve(t):"function"==typeof t.toDataURL&&t.toDataURL()?(n=t,"string"==typeof(n&&n.toDataURL)&&0===n.toDataURL().indexOf("data:image/png")?Promise.resolve(t):Promise.reject(new Error("Canvas tainted, cannot read image data"))):t.cloneNode(!1)}function o(t){var e=t.dataset.src;return e&&(t.src=e,delete t.dataset.src),new Promise((function(n){if(!t.complete)return t.onload=n;t.onload=null,setTimeout((function(){n(t)}),0),t.onerror=function(t){return n(t)}}))}function u(t,e){return t.toDataURL&&(e=e||{},e.width=e.width||t.naturalWidth,e.height=e.height||t.naturalHeight),new Promise((function(n,r){if(!t.src)return n(t);if("data:"===t.src.substr(0,5))return n(t);var i=new Image;i.onload=function(){return n(i)},i.onerror=r,i.crossOrigin="anonymous",i.src=t.src}))}function c(t){return new Promise((function(e,n){var r=new XMLHttpRequest;r.open("GET",t,!0),r.responseType="blob",r.onload=function(){this.status>=200&&this.status<400||/^blob:/.test(t)?e(r.response):n(new Error("Couldn't download image"))},r.onerror=n,r.send()}))}function a(t){return new Promise((function(e){if(!t.src)return e(t);if("data:"===t.src.substr(0,5))return e(t);var n=new Image;n.onload=function(){t.image=n,e(t)},n.src=t.src}))}function f(t,e,n){return e?Promise.resolve(t):new Promise((function(e){if("image/svg+xml"!==t.type)return e(t);var r=new FileReader;r.onloadend=function(){var r=new Image;r.onload=function(){return e(r)},r.src=r.result},r.readAsDataURL(t)}))}function l(t,e,n){var r=new FileReader;r.onloadend=function(){var r=new Image;r.onloadend=function(){var i=r.naturalWidth,o=r.naturalHeight,a=new OffscreenCanvas(i,o),c=a.getContext("2d");c.drawImage(r,0,0);var f=c.getImageData(0,0,i,o);e(f.data.buffer)},r.src=r.result},r.readAsArrayBuffer(t)}function s(t,e){var n,r,o;return e(this,void 0,void 0,(function(){var i,o,u,c,a;return n(this,(function(s){switch(s.label){case 0:return n=t,o=[e.width||t.naturalWidth,e.height||t.naturalHeight],[4,new Promise((function(t){return setTimeout(t,o[0]*o[1]/1e4)}))];case 1:return[4,n.decode()];case 2:return s.sent(),i=n.getContext("2d"),o[0]=e.width||n.naturalWidth,o[1]=e.height||n.naturalHeight,a=new OffscreenCanvas(o[0],o[1]),c=a.getContext("2d"),[4,Promise.all([p(n,e.filter||w),a])];case 3:return s.sent(),c.drawImage(a.canvas||a,0,0,o[0],o[1]),u=c.getImageData(0,0,o[0],o[1]),[2,u]}}))}))}var h="data:image/svg+xml;charset=utf-8,",d="data:image/svg+xml;base64,",p=function(t,e){var n,r,o,u,c,a,f,l,s,h,d,p,v,y;return e(this,void 0,void 0,(function(){var b;return n(this,(function(g){switch(g.label){case 0:return n=t,r=e.width,i=e.height,o=e.style,u=o&&o.font,c=e.fontEmbedCSS,a=void 0===c||c,[4,Promise.resolve(0)];case 1:if(g.sent(),u||!a){g.label=2;break}return[4,fetch("https://fonts.googleapis.com/css?family=".concat(encodeURIComponent(u))).then((function(t){return t.text()}))];case 2:return f=g.sent(),l=f.split("/*").slice(1).join("/*").split("@font-face {"),s=l.slice(1),h=String.fromCharCode(0xfeff),d=",".concat(h," "),p=[],s.forEach((function(t,e){var n=t.toLowerCase().split("font-family:")[1].split("\n")[0].trim(),r=t.toLowerCase().split("src:")[1].split(")")[0].split("format(")[1].split(")")[0].trim();p.push("".concat(n,d,"url(").concat(r,") format(").concat(r,")"))})),o.appendChild(document.createTextNode(p.join(""))),g.label=3;break;case 3:return v=o?o.cssValueOf():getComputedStyle(t).font,y=v.split(/\s*\d+\s*/)[0],[4,Promise.resolve(0)];case 4:return[4,fetch("https://fonts.googleapis.com/css?family=".concat(encodeURIComponent(y))).then((function(t){return t.text()}))];case 5:return b=g.sent(),o.appendChild(document.createTextNode(b)),[2]}}))}))},w=t=>"background:transparent",v=function(t,e,n){return e=t.toDataURL&&t.toDataURL(),n},y=function(t,e){return e=t,new Promise((function(e){var n=new FileReader;n.onloadend=function(){var n=new Image;n.onloadend=function(){var r=n.naturalWidth,i=n.naturalHeight,o=new OffscreenCanvas(r,i),u=o.getContext("2d");u.drawImage(n,0,0);var c=u.getImageData(0,0,r,i);e(c.data.buffer)},n.src=n.result},n.readAsArrayBuffer(t)}))},b=function(t){return"bitmap"===t.type&&(t=t.getContext("2d").getImageData(0,0,t.width,t.height).data.buffer)},g=function(t){var n=t.cloneNode(!1);try{n.removeChild(n.firstChild)}catch(t){}return n},k=function(t){var n=t.cloneNode(!1);return"outerHTML"in t&&(n.innerHTML=t.outerHTML),n};function m(t,e){var n,r,o,u;return e(this,void 0,void 0,(function(){var i,o,u,c,a,f,l,s,p,v,y,b,O,S,A,j,q,M,I,R,L,N,D;return n=this,(r=[t,e]).label=0,i=r[0],o=r[1],u=e(r[2])||{},c=u.width,a=u.height,f=u.style,l=u.quality,s=u.backgroundColor,p="image/jpeg"===u.type?v.bind(null,"image/jpeg",l):b,v=u.omitBackground,L=u.cache,N=u.imagePlaceholder,D=u.skipFonts,I=void 0!==D&&D,R=u.filter,L=u.duplicateTest,u=void 0===L||L,(b=function(t,e){return e=t.width,t.height}).label=1,(O=e(i,p)).label=2,O.sent(),(s&&"transparent"===getComputedStyle(i).background&&(s="white"),A=new Image,A.className="invisible-"+Date.now(),A.src=L,document.body.appendChild(A),(j=new Promise((function(t){A.onload=t}))).label=3,j.sent(),document.body.removeChild(A),(q=Promise.resolve(i.cloneNode(!0))).label=4,q.sent(),(M=document.createElement("canvas")).label=5,M.sent(),M.width=c||i.offsetWidth*2,M.height=a||i.offsetHeight*2,(I=null===D||void 0===D||D,(R=[3,4,5,2,6,7,8,9]).length=0,R[0]=R[2]=R[3]=R[4]=R[5]=R[6]=R[7]=R[8]=R[1],I[R[0]]=B(i,s,o,u,v,N),I[R[1]]=_,I[R[2]]=j,I[R[3]]=S,I[R[4]]=R,I[R[5]]=R,I[R[6]]=R,I[R[7]]=R,I[R[8]]=R,(R.label=6,R.sent(),(S=Promise.all(R)).label=7,S.sent(),(R=Promise.all(I.slice(2,6))).label=8,R.sent(),R[2]=i.offsetWidth*2,R[3]=i.offsetHeight*2,M.getContext("2d").drawImage(R[0],R[1],R[2],R[3]),(I=Promise.resolve(u.cache?caches.open(u.cache).then((function(t){return t.put(M.toDataURL(),new Response(M.toDataURL())),t.match(M.toDataURL()).then((function(t){return t}))})):Promise.resolve(M.toDataURL()))).label=9,I.sent())[2]=I.sent(),N=I))}}))}function _(t){return new Promise((function(e){setTimeout((function(){return e(t)}),0)}))}function B(t,e,n,r,i,o,u){return e(this,void 0,void 0,(function(){var c,a,f,l,s,v,b,g,k,w,T;return l=this,(f=[t,e,n,r,i,o,u]).label=0,c=f[0],a=f[1],n=f[2],r=f[3],i=f[4],o=f[5],u=f[6],s=e(c.cloneNode(!1)),v=Promise.resolve(s),b=function(t){var e,n,r={},i=t.cloneNode(!0);return i.style.background=a,["-webkit-background-clip","background-clip","-webkit-text-fill-color"].forEach((function(t){return i.style[t]="initial"})),n=i.querySelectorAll("*"),Array.from(n).forEach((function(t){var n,a,f,l,s,v,b,g;if(t instanceof HTMLImageElement){if("svg"===t.tagName.toLowerCase())return;try{f=t.style.getPropertyValue("background-image")}catch(t){}return g=t,("none"===g.style.background||""===g.style.background)&&"img"===g.tagName.toLowerCase()&&"inline"===getComputedStyle(g).display||((n=o(),n.style.cssText=t.style.cssText,n.width=t.width,n.height=t.height,n.src=t.src,n.dataset.src=t.src,delete n.src,t.parentNode&&t.parentNode.replaceChild(n,t)),g.src?void 0:void 0)}if(t instanceof HTMLInputElement&&"checkbox"===t.type){r={backgroundColor:"white",borderColor:"black",borderStyle:"solid",borderWidth:"1px",boxSizing:"border-box",color:"black",display:"inline-block",height:"14px",marginRight:"4px",verticalAlign:"middle",width:"14px"}}else if(t instanceof HTMLInputElement&&"radio"===t.type){r={backgroundColor:"white",borderColor:"black",borderStyle:"solid",borderWidth:"1px",boxSizing:"border-box",color:"black",display:"inline-block",height:"14px",marginRight:"4px",verticalAlign:"middle",width:"14px"}}else{try{f=t.style.getPropertyValue("background-image")}catch(t){}if((t.style&&t.style.backgroundImage||getComputedStyle(t).backgroundImage).replace(/url\((['"])?(.*?)\1\)/g,(function(t,e,n){return n&&(r[n]=t)})),f){var y=t.style.getPropertyPriority("background-image")||"";r[f]=u(t.style.getPropertyValue("background-image"))+" "+t.style.getPropertyPriority("background-image"),r[f]=t.style.getPropertyValue("background-image")+" "+y}}["border","border-color","box-shadow","padding","padding-top","padding-right","padding-bottom","padding-left","margin","margin-top","margin-right","margin-bottom","margin-left"].forEach((function(e){t.style[e]&&(r[e]=t.style[e])})),t.style.cssText}})),i.style.cssText=e,r},v=e((function(t){return new Promise((function(e,n){var r=new Image;r.onload=function(){return e(r)},r.onerror=n,r.crossOrigin="anonymous",r.src=t}))})),(g=Promise.resolve(b(i)).then((function(t){var e=i.outerHTML,n=document.createElement("img");n.className="invisible-"+Date.now(),n.src=o,n.onerror=function(t){console.error("Cannot fetch image: ".concat(t))},document.body.appendChild(n)})),(k=Promise.all(Array.from(i.querySelectorAll("img")).map((function(t){return new Promise((function(e,n){if(t.src&&"data:"!==t.src.substr(0,5)){var r=new Image;r.onload=function(){return e(r)},r.onerror=function(t){return n(t)},r.crossOrigin="anonymous",r.src=t.src}else e(t)}))}))).label=1,l.sent(),(w=Promise.resolve(c)).label=2,w.sent(),(T=m(c,a,u,!1,o)).label=3,T.sent(),g.label=4,g.sent(),k.label=5,k.sent(),w.label=6,w.sent(),T.label=7,T.sent(),(b={}).label=8,b.sent(),(b=o).label=9,b.sent()}))}))}var O=function(t){return String(t).replace(/([.*+?^${}()|[\]/\\])/g,"\\$1")},S=function(t){return t.replace(/%([0-9A-F]{2})/g,(function(t,e){return String.fromCharCode(parseInt(e,16))}))},A=function(t){var e="";for(var n in t)Object.prototype.hasOwnProperty.call(t,n)&&(e+="".concat(O(n),":").concat(t[n],";"));return e},j=function(t){var e="";for(var n in t)Object.prototype.hasOwnProperty.call(t,n)&&(e+="".concat(n,"=").concat(encodeURIComponent(t[n]),";"));return e},x=function(t,e){var n=new Image;n.src=t,n.width=e,n.height=e},E=function(t,e){var n=document.createElement("canvas");n.width=t,n.height=t;var r=n.getContext("2d");return r.drawImage(e,0,0),n},T=function(t,e){return e=t,new Promise((function(e){var n=new FileReader;n.onloadend=function(){var n=new Image;n.onloadend=function(){var r=n.naturalWidth,i=n.naturalHeight,o=new OffscreenCanvas(r,i),u=o.getContext("2d");u.drawImage(n,0,0);var c=u.getImageData(0,0,r,i);e(c.data.buffer)},n.src=n.result},n.readAsArrayBuffer(t)}))},F=function(t){var e=t.cloneNode(!0);return e.style.background="white",e.style.boxShadow="none",e},q=function(t){return Promise.resolve(t).then((function(t){return Promise.resolve(t).then((function(t){return t.cloneNode(!0)})).then((function(t){return t.style.cssText}))}))})},U=function(t){return Promise.resolve(t).then((function(t){return Promise.resolve(t).then((function(t){return t.cloneNode(!0)})).then((function(t){return t.style.cssText}))}))})},W=function(t){return new Promise((function(t){setTimeout((function(){return t(t)}),0)}))},H=function(){return new Promise((function(t){var e=document.createElement("link");e.rel="stylesheet",e.href="/styles.css",document.head.appendChild(e),e.onload=function(){return t()},e.onerror=function(){return t()}}))};return t.toSvg=function(t,e){return void 0===e&&(e={}),e(t,e=Object.assign({},{fontEmbedCSS:!0},e),"image/svg+xml")},t.toPng=function(t,r){return void 0===r&&(r={}),e(this,void 0,void 0,(function(){return n(this,(function(n){switch(n.label){case 0:return[4,e(t,r,"image/png")];case 1:return[2,n.sent().toDataURL()]}}))}))}))},t.toJpeg=function(t,e){return void 0===e&&(e={}),e(this,void 0,void 0,(function(){return n(this,(function(n){switch(n.label){case 0:return[4,e(t,e,"image/jpeg")];case 1:return[2,n.sent().toDataURL()]}}))}))}))}}));`

let htmlToImagePromise: Promise<HtmlToImage> | null = null
function loadHtmlToImage(): Promise<HtmlToImage> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('SSR: loadHtmlToImage called server-side'))
  }
  if (window.htmlToImage) return Promise.resolve(window.htmlToImage)
  if (htmlToImagePromise) return htmlToImagePromise

  htmlToImagePromise = new Promise<HtmlToImage>((resolve, reject) => {
    try {
      // Use Function constructor to evaluate the UMD bundle in the global
      // scope. The bundle is IIFE that assigns `htmlToImage` to
      // `globalThis` (window).
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      new Function(HTML_TO_IMAGE_UMD)()
      if (window.htmlToImage) {
        resolve(window.htmlToImage)
      } else {
        reject(
          new Error(
            'inlined UMD executed but window.htmlToImage is undefined',
          ),
        )
      }
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
  return htmlToImagePromise
}

type Props = {
  /** querySelector for the node to export */
  targetSelector: string
  /** suggested filename, e.g. "weekly-2026-W34.png" */
  filename: string
  /** Optional caption passed to Web Share API */
  shareTitle?: string
  /** Optional text passed alongside the image */
  shareText?: string
}

export default function ExportButton({
  targetSelector,
  filename,
  shareTitle = '成全操練',
  shareText = '',
}: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function exportPNG(): Promise<Blob | null> {
    setBusy(true)
    setError(null)
    try {
      const node = document.querySelector(targetSelector)
      if (!node) {
        setError(`找不到目標元素：${targetSelector}`)
        return null
      }
      const htmlToImage = await loadHtmlToImage()
      const dataUrl = await htmlToImage.toPng(node as HTMLElement, {
        // Bump pixel ratio for sharper output on retina displays
        pixelRatio: 2,
        // Cache buster on background to avoid transparent PNG
        backgroundColor: '#FFFBF2',
      })
      const blob = await (await fetch(dataUrl)).blob()
      return blob
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(`匯出失敗：${msg}`)
      return null
    } finally {
      setBusy(false)
    }
  }

  async function handleShare() {
    const blob = await exportPNG()
    if (!blob) return
    const file = new File([blob], filename, { type: 'image/png' })
    const nav = navigator as Navigator & {
      canShare?: (data: { files: File[] }) => boolean
    }
    if (nav.canShare && nav.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: shareTitle,
          text: shareText,
        })
        return
      } catch {
        // user cancelled or share failed — fall through to download
      }
    }
    // Fallback: trigger PNG download
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function handleDownloadOnly() {
    const blob = await exportPNG()
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="export-button-row">
      <button
        type="button"
        className="btn-primary export-button-main"
        onClick={handleShare}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? '匯出中…' : '📤 匯出並分享'}
      </button>
      <button
        type="button"
        className="btn-secondary export-button-alt"
        onClick={handleDownloadOnly}
        disabled={busy}
      >
        下載圖片
      </button>
      {error && (
        <p className="export-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}