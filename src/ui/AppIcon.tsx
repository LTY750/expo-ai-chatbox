import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import type { StyleProp, TextStyle } from 'react-native';

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

type IoniconName = ComponentProps<typeof Ionicons>['name'];

const ICONS: Record<AppIconName, IoniconName> = {
  menu: 'menu-outline',
  settings: 'settings-outline',
  add: 'add-outline',
  attach: 'add-outline',
  send: 'arrow-up-outline',
  stop: 'stop',
  back: 'arrow-back-outline',
  chevronRight: 'chevron-forward-outline',
  chevronDown: 'chevron-down-outline',
  document: 'document-text-outline',
  image: 'image-outline',
  search: 'search-outline',
  appearance: 'color-palette-outline',
  prompt: 'chatbox-ellipses-outline',
  model: 'hardware-chip-outline',
  generation: 'options-outline',
  copy: 'copy-outline',
  quote: 'return-up-back-outline',
  edit: 'create-outline',
  rename: 'text-outline',
  more: 'ellipsis-horizontal',
  retry: 'refresh-outline',
  delete: 'trash-outline',
  close: 'close-outline',
  check: 'checkmark-outline',
  expand: 'chevron-down-outline',
  collapse: 'chevron-up-outline',
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
  return <Ionicons name={ICONS[name]} size={size} color={color} style={style} />;
}
