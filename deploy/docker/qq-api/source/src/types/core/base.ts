/**
 * @fileoverview 核心通用类型定义抽象层
 * 本文件提供基础泛型接口、类型组合和条件类型，用于构建高可复用、类型安全的业务逻辑。
 * 遵循 SOLID 原则，特别是接口隔离（ISP）和依赖倒置（DIP）。
 */

type AnyFunction = (...args: never[]) => unknown;

// ==========================================
// 1. 基础泛型接口 (Base Generic Interfaces)
// ==========================================

/**
 * 字典类型 (Dictionary)
 * 用于定义键值对映射，支持任意字符串作为键，泛型 T 作为值类型。
 * @example
 * const userMap: Dictionary<User> = { "user1": { id: 1, name: "Alice" } };
 */
export interface Dictionary<T = any> {
  [key: string]: T;
}

/**
 * 通用 API 响应接口 (ApiResponse)
 * 规范化后端接口返回数据结构，泛型 T 代表具体业务数据类型。
 * @example
 * const res: ApiResponse<User> = { code: 0, message: "Success", data: { id: 1 } };
 */
export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data: T;
}

/**
 * 分页数据响应接口 (PaginatedResponse)
 * 用于列表分页请求的数据结构。
 * @example
 * const list: PaginatedResponse<User> = { list: [...], total: 100, page: 1, size: 10 };
 */
export interface PaginatedResponse<T> {
  list: T[];
  total: number;
  page: number;
  size: number;
}

/**
 * 成功结果 (Ok) 和 失败结果 (Err)
 * 借鉴 Rust 的 Result 模式，用于替代抛出异常的错误处理模式。
 */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/**
 * 结果联合类型 (Result)
 * 用于显式声明函数可能成功或失败的返回值。
 * @example
 * function divide(a: number, b: number): Result<number, string> {
 *   if (b === 0) return { ok: false, error: "Division by zero" };
 *   return { ok: true, value: a / b };
 * }
 */
export type Result<T, E = Error> = Ok<T> | Err<E>;

// ==========================================
// 2. 类型组合和派生 (Type Composition & Derivation)
// ==========================================

/**
 * 可空类型 (Nullable)
 * 允许类型为 null 或 undefined。
 * @example
 * let name: Nullable<string> = null;
 */
export type Nullable<T> = T | null | undefined;

/**
 * 深度可选类型 (DeepPartial)
 * 递归地将对象及其嵌套属性变为可选。
 * @example
 * type PartialConfig = DeepPartial<AppConfig>;
 */
export type DeepPartial<T> = T extends AnyFunction
  ? T
  : T extends Array<infer U>
    ? _DeepPartialArray<U>
    : T extends object
      ? _DeepPartialObject<T>
      : T | undefined;

type _DeepPartialArrayItem<T> = T extends object ? DeepPartial<T> : T;
interface _DeepPartialArray<T> extends Array<_DeepPartialArrayItem<T>> {}
type _DeepPartialObject<T> = {
  [P in keyof T]?: DeepPartial<T[P]>;
};

/**
 * 深度只读类型 (DeepReadonly)
 * 递归地将对象及其嵌套属性变为只读，防止被意外修改。
 * @example
 * const state: DeepReadonly<State> = { user: { name: "Bob" } };
 * // state.user.name = "Alice"; // Error
 */
export type DeepReadonly<T> = T extends AnyFunction
  ? T
  : T extends Array<infer U>
    ? _DeepReadonlyArray<U>
    : T extends object
      ? _DeepReadonlyObject<T>
      : T;

interface _DeepReadonlyArray<T> extends ReadonlyArray<DeepReadonly<T>> {}
type _DeepReadonlyObject<T> = {
  readonly [P in keyof T]: DeepReadonly<T[P]>;
};

/**
 * 移除只读属性 (Mutable)
 * 将对象的所有属性变为可写。
 * @example
 * type WritableUser = Mutable<ReadonlyUser>;
 */
export type Mutable<T> = {
  -readonly [P in keyof T]: T[P];
};

// ==========================================
// 3. 类型约束和条件类型 (Constraints & Conditional Types)
// ==========================================

/**
 * 提取 Promise 内部类型 (PromiseType)
 * 获取 Promise 解析后的值的类型。
 * @example
 * type T0 = PromiseType<Promise<string>>; // string
 */
export type PromiseType<T> = T extends Promise<infer U> ? U : T;

/**
 * 要求至少包含一个指定属性 (RequireAtLeastOne)
 * 对象必须包含 Keys 列表中的至少一个属性。
 * @example
 * type ContactInfo = RequireAtLeastOne<{ email: string; phone: string; address: string }, 'email' | 'phone'>;
 */
export type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = Pick<T, Exclude<keyof T, Keys>> &
  {
    [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>>;
  }[Keys];

/**
 * 要求恰好包含一个指定属性 (RequireExactlyOne)
 * 对象必须且只能包含 Keys 列表中的恰好一个属性，其他指定属性不可存在。
 * @example
 * type Identity = RequireExactlyOne<{ idCard: string; passport: string }, 'idCard' | 'passport'>;
 */
export type RequireExactlyOne<T, Keys extends keyof T = keyof T> = Pick<T, Exclude<keyof T, Keys>> &
  {
    [K in Keys]-?: Required<Pick<T, K>> & Partial<Record<Exclude<Keys, K>, never>>;
  }[Keys];

/**
 * 条件类型：如果条件为真则返回 TrueType，否则返回 FalseType (If)
 * @example
 * type IsString<T> = If<T extends string ? true : false, "Yes", "No">;
 */
export type If<Condition extends boolean, TrueType, FalseType> = Condition extends true
  ? TrueType
  : FalseType;

/**
 * 类型相等检查 (IsEqual)
 * 检查两个类型 X 和 Y 是否完全相等，如果相等返回 true，否则返回 false。
 * @example
 * type T1 = IsEqual<string, string>; // true
 * type T2 = IsEqual<string, number>; // false
 */
export type IsEqual<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
