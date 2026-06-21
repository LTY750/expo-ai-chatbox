// Platform 抽象层 —— 借鉴 Chatbox：把跟系统打交道的能力收敛到一个接口后面
// 上层业务只调这里，以后换桌面端只需替换实现

import * as SecureStore from 'expo-secure-store';

export interface Platform {
  // 安全存储：API key 等敏感信息（进系统钥匙串）
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
}

const SECRET_PREFIX = 'chatbox_';

// 基于 Expo 的实现
const expoPlatform: Platform = {
  async getSecret(key) {
    return SecureStore.getItemAsync(SECRET_PREFIX + key);
  },
  async setSecret(key, value) {
    await SecureStore.setItemAsync(SECRET_PREFIX + key, value);
  },
  async deleteSecret(key) {
    await SecureStore.deleteItemAsync(SECRET_PREFIX + key);
  },
};

export const platform: Platform = expoPlatform;

// 密钥的统一 key 名
export const SECRET_KEYS = {
  siliconflowApiKey: 'siliconflow_api_key',
} as const;
