<p align="center">
  <img src="apps/web/public/brand/logo-256.png" alt="胖虎阅读" width="140" />
</p>
# reader-panghu

涓€涓妸銆學ebView 涔︽簮銆嶃€岄槄璇? 涔︽簮銆嶃€屾湰鍦颁功銆嶃€屽绔繘搴﹀悓姝ャ€嶆敹鏁涘埌鍚屼竴濂楁湇鍔＄鐨勯槄璇绘湇鍔°€?
Web UI 鎸?`reader-next` 鐨勪氦浜?*鐙珛閲嶅啓**锛圴ue 3锛屾湭澶嶅埗鍏舵簮鐮侊級锛屾湇鍔＄瀹炵幇 `/reader3/*` 濂戠害锛屽悓鏃跺澶栨彁渚涢槄璇? 瑙勫垯涔︽簮锛孡egado 瀹㈡埛绔紙iOS/Android锛夊彲鐩存帴瀵煎叆銆?
## 鐜板湪鑳借窇浠€涔?
鍏ㄩ儴涓烘湰鍦板疄娴嬶紝闈炶璁＄銆?
| 鑳藉姏 | 鐘舵€?| 瀹炴祴 |
|---|---|---|
| 鏈嶅姟绔墽琛?WebView 涔︽簮锛堣捣鐐硅嚜寤烘簮锛孒TML 鏈敼锛?| 鉁?| 鎼滅储 1.0s / 璇︽儏 1.0s / 鐩綍 952 绔?0.9s / 姝ｆ枃 1.7s |
| `flutter_inappwebview` 妗ュ湪 Node 閲屽疄鐜?| 鉁?| `http` / `cookie.*` / `cache.*` / `log` / `toast` |
| `/reader3/*` 濂戠害锛堜功鏋躲€佹悳绱?SSE銆佺洰褰曘€佹鏂囥€佽繘搴︼級 | 鉁?| 14 椤瑰啋鐑熸祴璇曞叏杩?|
| reader-next Vue3 UI 鏋勫缓骞剁敱鍚岀鍙ｆ彁渚?| 鉁?| `apps/web/dist`锛孲PA 鍥為€€鍙敤 |
| 闃呰3 涔︽簮鐢熸垚锛堢粰 Legado 瀹㈡埛绔級 | 鉁?| `/api/legado-source/:id` |
| 鏈湴 TXT 涓婁紶 + 鑷姩鍒嗙珷 + 闃呰 | 鉁?| 涓枃 GBK 鍏滃簳瑙ｇ爜 |
| 涔︽簮瀵煎叆锛堟枃浠?/ 杩滅▼ URL锛?| 鉁?| `readSourceFile`銆乣readRemoteSourceFile` |
| 灏侀潰/涔﹀悕/浣滆€?绠€浠嬫墜宸ョ紪杈?| 鉁?| `saveBook` + `uploadBookCover` |
| 涔︾銆佹浛鎹㈣鍒?| 鉁?| 钀藉簱 |
| 澶氱杩涘害鍚屾锛堟湇鍔＄鏉冨▉锛?| 鉁?| `saveBookProgress` 瑕嗙洊鏈€鏂帮紝涔︽灦鍥炶涓€鑷?|
| 鏈湴涔︽牸寮?TXT / EPUB / DOCX / MOBI | 鉁?| 鍚勮嚜鍚堟垚鏍锋湰涓婁紶鍚庡垎绔犮€佹鏂囥€佸皝闈㈠潎閫氳繃 |
| 涔︽簮璁㈤槄锛圠egado 鑷姩鎷夊彇锛?| 鉁?| `/api/subscribe` 杩斿洖鍙鍏ョ殑闃呰3 涔︽簮鏁扮粍 |
| PDF锛堟枃瀛楃増锛?| 馃И 鍙€夛紝闈炵洰鏍?| 鎻愬彇 Tj/TJ + FlateDecode锛涗笉鍋氭壂鎻忕増/OCR锛屽彲闅忔椂绉婚櫎 |
| RSS 璁㈤槄 | 鉁?| 婧愬鍒犳煡 路 RSS/Atom 瑙ｆ瀽 路 姝ｆ枃鎶撳彇锛堝墧闄?script锛壜?鏂囩珷缂撳瓨 + 鍚庡彴瀹氭椂鍒锋柊 |
| WebDAV 澶囦唤 | 鉁?| `/reader3/webdavBackup` 涓?`/webdavRestore`锛屽紓绫诲浠藉寘琚嫆 |

## 蹇€熷紑濮?
```bash
pnpm install
pnpm --filter reader-panghu-web run build   # 鏋勫缓 UI
PORT=18080 node apps/server/src/index.js    # 鍚岀鍙ｆ彁渚?UI + API
```

鎵撳紑 <http://localhost:18080>銆?
鏀惧叆涔︽簮锛坄data/sources/<id>.json`锛岄娆″惎鍔ㄤ細瀵煎叆鏁版嵁搴擄級锛?
```json
{
  "bookSourceName": "璧风偣路鑷缓路瀹跺",
  "bookSourceUrl": "http://example.com/k/xxx",
  "html": "<!DOCTYPE html>鈥?,
  "_runtime": {
    "rewrites": [{ "from": "http://dead-host:4280", "to": "http://live-host:4280" }],
    "key": "涔︽簮瀵嗛挜"
  }
}
```

涔熷彲浠ョ敤鐜鍙橀噺缁熶竴鏀圭嚎璺紙瀵规墍鏈変功婧愮敓鏁堬級锛?
```bash
SOURCE_REWRITES='[{"from":"http://dead-host:4280","to":"http://live-host:4280"}]'
```

`_runtime` 鏄湰鏈嶅姟鍔犵殑杩愯鍙傛暟锛屽鍏ラ槄璇? 瀹㈡埛绔椂浼氳蹇界暐銆?
## 涓ゅ鎺ュ彛

### `/reader3/*` 鈥?Web UI / 闃呰3 瀹㈡埛绔绾?
缁熶竴杩斿洖 `{isSuccess, errorMsg, data}`銆備富瑕佺鐐癸細

| 绔偣 | 璇存槑 |
|---|---|
| `GET /getBookshelf` | 涔︽灦锛堝惈杩涘害锛?|
| `POST /getBookInfo` 路 `/getChapterList` 路 `/getBookContent` | 璇︽儏 / 鐩綍 / 姝ｆ枃 |
| `POST /saveBook` 路 `/saveBooks` 路 `/saveBookProgress` | 鍔犲叆涔︽灦 / 缂栬緫鍏冩暟鎹?/ 杩涘害 |
| `GET /getBookSources` 路 `POST /saveBookSources` | 涔︽簮绠＄悊 |
| `GET /searchBookMultiSSE` | 璺ㄤ功婧愭悳绱紙SSE 娴侊紝`data:` 甯?+ `end` 浜嬩欢锛?|
| `POST /uploadTxtBook` | 鏈湴 TXT锛堣嚜鍔ㄥ垎绔狅級 |
| `POST /uploadBookCover` 路 `/resetBookCover` | 灏侀潰鏇挎崲 / 杩樺師 |
| `GET/POST /getBookmarks` 绯诲垪銆乣/getReplaceRules` 绯诲垪 | 涔︾銆佹浛鎹㈣鍒?|

### `/api/*` 鈥?涔︽簮瀵煎悜鎺ュ彛

`/api/search`銆乣/api/book`銆乣/api/toc`銆乣/api/content`銆乣/api/legado-source/:id`锛岃繑鍥炲甫鑷寚 URL 鐨?JSON锛屼緵闃呰3 瑙勫垯涔︽簮鐩存帴娑堣垂銆?
## 鐩綍缁撴瀯

```
apps/server/             Fastify 鏈嶅姟锛?reader3 濂戠害銆?api銆丼QLite銆佷功婧愯繍琛屾椂璋冨害
apps/web/                reader-next 鐨?Vue 3 鍓嶇锛堟瀯寤哄埌 dist/锛?packages/source-runtime/ WebView 涔︽簮杩愯鏃讹紙jsdom + jQuery + 妗ワ級
packages/legado-source/  闃呰3 涔︽簮鐢熸垚鍣?scripts/                 鎺㈤拡涓庡啋鐑熸祴璇曪紙test-reader3 / test-extras / probe-source锛?docker/                  Dockerfile 涓?compose
docs/                    鏋舵瀯璇存槑
data/                    杩愯鏁版嵁锛坓it 蹇界暐锛?```

## 涓轰粈涔堥渶瑕併€屾湇鍔＄涔︽簮杩愯鏃躲€?
Legado 瀹舵棌涔︽簮鏈変袱绉嶅舰鎬侊細

1. **瑙勫垯鍨?*锛坄ruleSearch` / JSONPath / CSS / `@js:`锛夆€斺€旂函鏁版嵁锛屽鎴风寮曟搸鎵ц銆?2. **WebView 鍨?*锛坄html` 瀛楁 + `flutter_inappwebview.callHandler`锛夆€斺€旀湰璐ㄦ槸杩愯鍦?WebView 閲岀殑绋嬪簭銆?
`legado-ios v0.1.14` 鍙敮鎸佺 1 绉嶏紙浜岃繘鍒堕噷鏈?`ruleSearch`銆乣SwiftSoup`銆乣java.ajax`锛屼絾娌℃湁 `flutter_inappwebview` / `callHandler`锛夈€傛墍浠ユ湰椤圭洰鍦ㄦ湇鍔＄瀹炵幇 WebView 杩愯鏃讹紝鍐嶆妸缁撴灉闄嶇淮鎴愯鍒欏瀷涔︽簮鈥斺€擜PP 涓€琛?Swift 閮戒笉鐢ㄦ敼銆?
## 閮ㄧ讲鍒版瀬绌洪棿 NAS锛堝凡瀹炴祴锛?
鏋佺┖闂?Compose **涓嶆敮鎸?`build:`**锛屾瀯寤洪暅鍍忚鐢ㄦ寕杞?`docker.sock` 鐨?builder 瀹瑰櫒锛?
```bash
docker build -f docker/Dockerfile -t reader-panghu:nas <婧愮爜鐩綍>
# 鍐嶇敤 image: reader-panghu:nas 鍒涘缓甯搁┗瀹瑰櫒锛岀鍙?18080:18080锛屾暟鎹寕鍒板涓绘満鐩綍
```

娉ㄦ剰锛欴ockerfile 椤堕儴**涓嶈**鍐?`# syntax=docker/dockerfile:1` 鈥斺€?瀹冧細璁?BuildKit 鍘?Docker Hub 鎷夊墠绔暅鍍忥紝鍙楅檺缃戠粶涓嬬洿鎺ヨ秴鏃躲€?
## 涓€閿獙璇?
```bash
pnpm verify          # 闈欐€佹牎楠?28椤? + 璧蜂复鏃跺疄渚嬭窇鍏ㄩ儴 11 涓浠?pnpm verify:tests    # 鍙窇濂椾欢
```

閫€鍑虹爜鍗崇粨璁猴紙0 鍏ㄧ豢锛夛紝鍙洿鎺ョ敤浜?CI 鎴栦氦浠樺墠鑷銆?
## 娴嬭瘯

```bash
node scripts/check-docker.mjs   # Docker 鏋勫缓杈撳叆鐨勯潤鎬佹牎楠岋紙鏃?docker 鐜鏃剁敤锛?node scripts/test-reader3.mjs   # 濂戠害绔埌绔紙鎼滅储鈫掕鎯呪啋鐩綍鈫掓鏂団啋杩涘害鈫扴SE锛?node scripts/test-extras.mjs    # 涔︾/鏇挎崲瑙勫垯/涔︽簮瀵煎叆/鏈湴 TXT
node scripts/probe-source.js <source.json>   # 鐩存帴璺戝崟涓功婧?```

## 璁稿彲璇?
AGPL-3.0銆傚叏閮ㄤ唬鐮佷负鏈」鐩師鍒涘疄鐜帮細鏈嶅姟绔€佷功婧愯繍琛屾椂銆佷互鍙婃寜 reader-next 浜や簰鐙珛閲嶅啓鐨?Vue UI銆傚弬鑰冮」鐩笌鍊熼壌鑼冨洿瑙?[NOTICE](NOTICE)銆?