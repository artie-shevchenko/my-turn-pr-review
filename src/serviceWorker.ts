import { trySync } from "./sync";

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason == "install") {
    chrome.action.setIcon({
      path: "icons/grey128.png",
    });

    console.log("Extension successfully installed!");
  }
});

async function checkAlarmState() {
  const alarm = await chrome.alarms.get("sync-alarm");

  if (!alarm) {
    console.log("Alarm not found, creating...");
    await chrome.alarms.create("sync-alarm", { periodInMinutes: 0.5 });
  }

  const hasListeners = await chrome.alarms.onAlarm.hasListeners();
  if (!hasListeners) {
    console.log("Alarm listener not found, creating...");
    await chrome.alarms.onAlarm.addListener(() => {
      waitUntil(trySync());
    });
  }
}

// https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers#keep_a_service_worker_alive_until_a_long-running_operation_is_finished
async function waitUntil(promise: Promise<void>) {
  const keepAlive = setInterval(chrome.runtime.getPlatformInfo, 25 * 1000);
  try {
    await promise;
  } finally {
    clearInterval(keepAlive);
  }
}

checkAlarmState();
