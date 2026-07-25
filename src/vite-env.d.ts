/// <reference types="vite/client" />

// Allow direct SVG imports as asset URLs (logo, brand icons)
declare module "*.svg" {
  const src: string;
  export default src;
}