import type { StyleProp, TextStyle } from 'react-native';
import { Text } from 'react-native';

export type AppIconName =
  | 'menu'
  | 'settings'
  | 'add'
  | 'attach'
  | 'send'
  | 'stop'
  | 'back'
  | 'chevronRight'
  | 'chevronDown'
  | 'document'
  | 'image'
  | 'search'
  | 'appearance'
  | 'prompt'
  | 'model'
  | 'generation'
  | 'copy'
  | 'quote'
  | 'edit'
  | 'rename'
  | 'more'
  | 'retry'
  | 'delete'
  | 'close'
  | 'check'
  | 'expand'
  | 'collapse';

const GLYPHS: Record<AppIconName, string> = {
  menu: '≡',
  settings: '⚙︎',
  add: '＋',
  attach: '⊕',
  send: '↑',
  stop: '■',
  back: '‹',
  chevronRight: '›',
  chevronDown: '⌄',
  document: '▤',
  image: '▧',
  search: '⌕',
  appearance: '◐',
  prompt: '¶',
  model: '◫',
  generation: '⌁',
  copy: '⧉',
  quote: '❞',
  edit: '✎',
  rename: 'Aa',
  more: '•••',
  retry: '↻',
  delete: '⌫',
  close: '×',
  check: '✓',
  expand: '⌄',
  collapse: '⌃',
};

export function AppIcon({
  name,
  size = 20,
  color,
  style,
}: {
  name: AppIconName;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text
      allowFontScaling={false}
      style={[{ fontSize: size, lineHeight: Math.ceil(size * 1.15), color, textAlign: 'center' }, style]}
    >
      {GLYPHS[name]}
    </Text>
  );
}
