// Mermaid 图表渲染 —— 用 WebView + mermaid.js
// 识别 ```mermaid 代码块，渲染成流程图/时序图等
import { useMemo } from 'react';
import { WebView } from 'react-native-webview';

interface MermaidViewProps {
  code: string; // mermaid 源码
  color?: string; // 文字颜色，默认黑
  isDark?: boolean; // 是否深色模式，决定 mermaid 内部 SVG 主题
}

export function MermaidView({ code, color = '#111', isDark = false }: MermaidViewProps) {
  const html = useMemo(() => {
    const escaped = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
  html, body { margin: 0; padding: 8px; background: transparent; }
  body { color: ${color}; font-size: 14px; }
  #err { color: #c00; font-family: monospace; white-space: pre-wrap; }
</style>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
</head>
<body>
<div id="out"></div>
<script>
  (async () => {
    try {
      mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default', securityLevel: 'loose' });
      const { svg } = await mermaid.render('m', ${JSON.stringify(escaped)});
      document.getElementById('out').innerHTML = svg;
      // 通知 RN 高度
      setTimeout(() => {
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
          JSON.stringify({ type: 'done', height: document.body.scrollHeight })
        );
      }, 100);
    } catch (e) {
      document.getElementById('out').innerHTML = '<div id="err">Mermaid 渲染失败：' + (e.message || e) + '</div>';
    }
  })();
</script>
</body>
</html>`;
  }, [code, color, isDark]);

  return (
    <WebView
      originWhitelist={['*']}
      source={{ html }}
      style={{ backgroundColor: 'transparent', height: 300, width: '100%' }}
      scrollEnabled={false}
      javaScriptEnabled
    />
  );
}
