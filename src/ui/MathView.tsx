// LaTeX 公式渲染 —— 用 WebView + MathJax，避免引入原生依赖
// 支持行内 $...$ 和块级 $$...$$
// 原理：把公式文本塞进 HTML，让 MathJax 渲染成 SVG，WebView 显示
import { useMemo } from 'react';
import { WebView } from 'react-native-webview';

interface MathViewProps {
  tex: string; // 公式内容（不含 $ 符号）
  display?: boolean; // true=块级公式，false=行内
  color?: string; // 文字颜色，默认黑
}

export function MathView({ tex, display = false, color = '#111' }: MathViewProps) {
  const html = useMemo(() => {
    const escaped = tex
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const delimiter = display ? '\\[' : '\\(';
    const endDelimiter = display ? '\\]' : '\\)';
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  body { color: ${color}; font-size: 15px; line-height: 1.4; }
  #math { display: inline; }
</style>
<script>
  window.MathJax = {
    tex: { inlineMath: [['\\\\(','\\\\)']], displayMath: [['\\\\[','\\\\]']] },
    svg: { fontCache: 'global' },
    startup: {
      ready: () => {
        MathJax.startup.defaultReady();
        MathJax.startup.promise.then(() => {
          // 渲染完成后通知 RN 调整高度
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
            JSON.stringify({ type: 'done', height: document.body.scrollHeight })
          );
        });
      }
    }
  };
</script>
<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>
</head>
<body><span id="math">${delimiter}${escaped}${endDelimiter}</span></body>
</html>`;
  }, [tex, display, color]);

  return (
    <WebView
      originWhitelist={['*']}
      source={{ html }}
      style={{ backgroundColor: 'transparent', height: 40, width: '100%' }}
      scrollEnabled={false}
      javaScriptEnabled
      onMessage={() => {
        // 可在此动态调整高度，当前用固定高度简化
      }}
    />
  );
}
