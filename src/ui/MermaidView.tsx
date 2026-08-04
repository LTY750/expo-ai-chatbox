// Mermaid 图表渲染 —— 用 WebView + mermaid.js
// 识别 ```mermaid 代码块，渲染成流程图/时序图等
import { useMemo, useState } from 'react';
import { WebView } from 'react-native-webview';

interface MermaidViewProps {
  code: string; // mermaid 源码
  color?: string; // 文字颜色，默认黑
  isDark?: boolean; // 是否深色模式，决定 mermaid 内部 SVG 主题
}

const MAX_WEBVIEW_HEIGHT = 800;
const WEBVIEW_BASE_URL = 'https://chatbox.local/';
const MERMAID_SCRIPT_URL =
  'https://cdn.jsdelivr.net/npm/mermaid@11.16.0/dist/mermaid.min.js';

function serializeForInlineScript(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function MermaidView({ code, color = '#111', isDark = false }: MermaidViewProps) {
  const [height, setHeight] = useState(240);
  const [scrollable, setScrollable] = useState(false);
  const html = useMemo(() => {
    const serializedCode = serializeForInlineScript(code);
    const serializedTheme = JSON.stringify(isDark ? 'dark' : 'default');
    const safeColor = /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#111';
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src data: blob:; font-src data: https://cdn.jsdelivr.net; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<style>
  html, body { margin: 0; padding: 4px; background: transparent; overflow: hidden; }
  body { color: ${safeColor}; font-size: 14px; }
  #out svg { display: block; max-width: 100%; height: auto; }
  #err { color: #c00; font-family: monospace; white-space: pre-wrap; }
</style>
<script src="${MERMAID_SCRIPT_URL}"></script>
</head>
<body>
<div id="out"></div>
<script>
  const reportSize = () => {
    const out = document.getElementById('out');
    const svg = out.querySelector('svg');
    // 直接量 SVG，避免 WebView 的初始高度被容器 scrollHeight 误当成内容高度。
    const contentHeight = Math.ceil(
      Math.max(svg ? svg.getBoundingClientRect().height : 0, out.getBoundingClientRect().height) + 16
    );
    const scrollable = contentHeight > ${MAX_WEBVIEW_HEIGHT};
    document.documentElement.style.overflowY = scrollable ? 'auto' : 'hidden';
    document.body.style.overflowY = scrollable ? 'auto' : 'hidden';
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
      JSON.stringify({ type: 'done', height: contentHeight, scrollable })
    );
  };
  (async () => {
    try {
      mermaid.initialize({ startOnLoad: false, theme: ${serializedTheme}, securityLevel: 'strict' });
      const { svg } = await mermaid.render('m', ${serializedCode});
      document.getElementById('out').innerHTML = svg;
      // 通知 RN 高度
      setTimeout(() => {
        reportSize();
      }, 100);
    } catch (e) {
      const out = document.getElementById('out');
      const err = document.createElement('div');
      err.id = 'err';
      err.textContent = 'Mermaid 渲染失败：' + (e.message || e);
      out.replaceChildren(err);
      reportSize();
    }
  })();
</script>
</body>
</html>`;
  }, [code, color, isDark]);

  return (
    <WebView
      originWhitelist={['https://chatbox.local', 'about:blank']}
      source={{ html, baseUrl: WEBVIEW_BASE_URL }}
      style={{ backgroundColor: 'transparent', height, width: '100%' }}
      scrollEnabled={scrollable}
      nestedScrollEnabled={scrollable}
      showsVerticalScrollIndicator={scrollable}
      javaScriptEnabled
      domStorageEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      javaScriptCanOpenWindowsAutomatically={false}
      setSupportMultipleWindows={false}
      mixedContentMode="never"
      onShouldStartLoadWithRequest={(request) =>
        request.url === WEBVIEW_BASE_URL || request.url === 'about:blank'
      }
      onMessage={(event) => {
        try {
          const message = JSON.parse(event.nativeEvent.data);
          const measured = Number(message?.height);
          if (message?.type === 'done' && Number.isFinite(measured)) {
            const shouldScroll = message?.scrollable === true || measured > MAX_WEBVIEW_HEIGHT;
            setScrollable(shouldScroll);
            setHeight(
              shouldScroll
                ? MAX_WEBVIEW_HEIGHT
                : Math.min(Math.max(measured, 80), MAX_WEBVIEW_HEIGHT)
            );
          }
        } catch {
          // 忽略非高度消息
        }
      }}
    />
  );
}
