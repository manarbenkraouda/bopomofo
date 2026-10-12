/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";

Config.setRspack(true);
// PNG frames give a true yuv420p (limited range) H.264 stream. JPEG frames gave yuvj420p.
Config.setVideoImageFormat("png");
Config.setOverwriteOutput(true);
Config.setDefaultPremountInSeconds(2);

// This PC is Windows on ARM64. Remotion has no Chrome Headless Shell for it, so use the installed Chrome.
Config.setBrowserExecutable("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
Config.setChromeMode("chrome-for-testing");
