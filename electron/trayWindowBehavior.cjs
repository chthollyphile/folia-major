// electron/trayWindowBehavior.cjs
// 主窗口托盘行为的纯判定逻辑，从 main.cjs 抽出以便单测覆盖。

/**
 * 判断点击关闭按钮时是否应该把主窗口隐藏到托盘而不是退出应用。
 * 托盘缺失时必须放行关闭，否则窗口会被隐藏且用户无法找回。
 */
function shouldHideMainWindowOnClose({ hasTray, isQuitting, closeToTrayEnabled }) {
  if (!closeToTrayEnabled) {
    return false;
  }

  if (isQuitting) {
    return false;
  }

  return Boolean(hasTray);
}

module.exports = {
  shouldHideMainWindowOnClose,
};
