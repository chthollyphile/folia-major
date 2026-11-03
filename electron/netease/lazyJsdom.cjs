const Module = require('module');

// electron/netease/lazyJsdom.cjs
// 网易云 API 的包一加载就 require jsdom（module/register_checktoken_v2.js 开头），可是只有带
// checkToken 的请求（收藏歌单）才真的用它，而加载它要占掉整个包一多半的时间。
// 这里在包加载之前往 require 缓存里放一个替身：JSDOM 和 VirtualConsole 这两个类到第一次被构造、
// 被调用或被读属性时才加载真的 jsdom。包要是取了别的导出，当场就加载真的：结果不会错，只是不省时间。

const DEFERRED_EXPORTS = ['JSDOM', 'VirtualConsole'];

// 用替身占住 jsdom 在 require 缓存里的位置。resolveFrom 是包里某个文件的路径：按它的位置找 jsdom，
// 找到的才是包自己会加载的那一份。返回有没有放上替身。
function deferJsdom(resolveFrom) {
  const packageRequire = Module.createRequire(resolveFrom);
  let jsdomPath;
  try {
    jsdomPath = packageRequire.resolve('jsdom');
  } catch {
    // 包不再依赖 jsdom：没有东西可推迟。
    return false;
  }
  if (packageRequire.cache[jsdomPath]) {
    return false;
  }

  let real = null;
  const loadReal = () => {
    if (!real) {
      // 先拿掉替身，require 才会去加载真的；加载完缓存里就是真的那一份。
      delete packageRequire.cache[jsdomPath];
      real = packageRequire(jsdomPath);
    }
    return real;
  };

  // 目标必须是普通函数：只有它既能被 new 也能被调用。
  const deferredClass = (name) => {
    const standIn = new Proxy(function deferred() {}, {
      // newTarget 是 new 后面写的那个类。是替身自己就换成真的类；是继承了替身的子类就原样传下去，
      // 造出来的对象才带着子类自己的方法。
      construct: (_target, args, newTarget) => {
        const realClass = loadReal()[name];
        return Reflect.construct(realClass, args, newTarget === standIn ? realClass : newTarget);
      },
      apply: (_target, thisArg, args) => Reflect.apply(loadReal()[name], thisArg, args),
      get: (_target, property) => Reflect.get(loadReal()[name], property),
      has: (_target, property) => Reflect.has(loadReal()[name], property),
    });
    return standIn;
  };
  const deferred = Object.fromEntries(DEFERRED_EXPORTS.map((name) => [name, deferredClass(name)]));

  const stub = new Module(jsdomPath);
  stub.filename = jsdomPath;
  stub.loaded = true;
  stub.exports = new Proxy({}, {
    get: (_target, name) => (Object.hasOwn(deferred, name) ? deferred[name] : loadReal()[name]),
    has: (_target, name) => Object.hasOwn(deferred, name) || name in loadReal(),
    ownKeys: () => Reflect.ownKeys(loadReal()),
    getOwnPropertyDescriptor: (_target, name) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(loadReal(), name);
      // 代理的目标是空对象，上面没有的属性只能报成可配置的。
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  });
  packageRequire.cache[jsdomPath] = stub;
  return true;
}

module.exports = {
  deferJsdom,
};
