/// <reference types="vite/client" />
import type { Toolbox } from '../preload'
declare global { interface Window { toolbox: Toolbox } }
export {}
