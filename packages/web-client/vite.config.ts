import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import os from 'node:os';

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  
  // 优先返回 192.168.x.x 频段的物理网卡 IP
  const pref = ips.find(ip => ip.startsWith('192.168.'));
  if (pref) return pref;
  
  // 排除通常作为虚拟网卡的 172.x.x.x 和 APIPA (169.254.x.x)
  const fallback = ips.find(ip => !ip.startsWith('172.') && !ip.startsWith('169.254.'));
  return fallback || ips[0] || '127.0.0.1';
}

// 自动注入本地 IP 作为调度服务的地址，支持移动端或其他设备调试测试
process.env.VITE_SCHEDULER_URL = process.env.VITE_SCHEDULER_URL || `http://${getLocalIP()}:8787`;

const configDir = path.dirname(fileURLToPath(import.meta.url));
const threeRoot = path.resolve(configDir, '../../../references/open_source_projects/rendering/three.js');

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^three$/,
        replacement: path.join(threeRoot, 'build/three.module.js')
      },
      {
        find: /^three\/examples\/jsm/,
        replacement: path.join(threeRoot, 'examples/jsm')
      }
    ]
  }
});