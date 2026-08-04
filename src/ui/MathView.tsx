// LaTeX 公式渲染 —— 用 WebView + MathJax，避免引入原生依赖
// 支持行内 $...$ 和块级 $$...$$
// 原理：把公式文本塞进 HTML，让 MathJax 渲染成 SVG，WebView 显示
import { useMemo, useState } from 'react';
import { WebView } from 'react-native-webview';

interface MathViewProps {
  tex: string; // 公式内容（不含 $ 符号）
  display?: boolean; // true=块级公式，false=行内
  color?: string; // 文字颜色，默认黑
}

const WEBVIEW_BASE_URL = 'https://chatbox.local/';
const MATHJAX_SCRIPT_URL =
  'https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js';

export function MathView({ tex, display = false, color = '#111' }: MathViewProps) {
  const [height, setHeight] = useState(display ? 56 : 40);
  const html = useMemo(() => {
    const escaped = tex
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const delimiter = display ? '\\[' : '\\(';
    const endDelimiter = display ? '\\]' : '\\)';
    const safeColor = /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#111';
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src data: blob:; font-src data: https://cdn.jsdelivr.net; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  body { color: ${safeColor}; font-size: 15px; line-height: 1.4; }
  #math { display: inline; }
  #error { color: #c00; font-family: sans-serif; font-size: 13px; }
</style>
<script>
  const reportHeight = () => {
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
      JSON.stringify({ type: 'done', height: document.body.scrollHeight })
    );
  };
  window.addEventListener('error', (event) => {
    if (event.target && event.target.tagName === 'SCRIPT') {
      const math = document.getElementById('math');
      math.id = 'error';
      math.textContent = '公式组件加载失败，请检查网络后重试';
      reportHeight();
    }
  }, true);
  window.MathJax = {
    tex: { inlineMath: [['\\\\(','\\\\)']], displayMath: [['\\\\[','\\\\]']] },
    svg: { fontCache: 'global' },
    startup: {
      ready: () => {
        MathJax.startup.defaultReady();
        MathJax.startup.promise.then(() => {
          // 渲染完成后通知 RN 调整高度
          reportHeight();
        });
      }
    }
  };
</script>
<script src="${MATHJAX_SCRIPT_URL}"></script>
</head>
<body><span id="math">${delimiter}${escaped}${endDelimiter}</span></body>
</html>`;
  }, [tex, display, color]);

  return (
    <WebView
      originWhitelist={['https://chatbox.local', 'about:blank']}
      source={{ html, baseUrl: WEBVIEW_BASE_URL }}
      style={{ backgroundColor: 'transparent', height, width: '100%' }}
      scrollEnabled={false}
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
            setHeight(Math.min(Math.max(measured + 2, display ? 40 : 24), display ? 600 : 120));
          }
        } catch {
          // 忽略非高度消息
        }
      }}
    />
  );
}
