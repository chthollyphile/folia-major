import React from 'react';

// src/components/ui/index.ts
// 洛雪组件用到的轻量控件入口。上游这层控件的约定是「外观完全由调用方 className 决定」，
// 自用版把其它控件收敛进了设置页 kit，这里只补洛雪用到的那几个薄包装，不搬整套旧控件。

export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button';

export type TextFieldProps = React.InputHTMLAttributes<HTMLInputElement>;
export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(({ className, ...rest }, ref) => (
    <input ref={ref} {...rest} className={className} />
));
TextField.displayName = 'TextField';

export type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;
export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(({ className, ...rest }, ref) => (
    <textarea ref={ref} {...rest} className={className} />
));
TextArea.displayName = 'TextArea';

export type CheckboxProps = React.InputHTMLAttributes<HTMLInputElement>;
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(({ className, ...rest }, ref) => (
    <input ref={ref} type="checkbox" {...rest} className={className} />
));
Checkbox.displayName = 'Checkbox';

export type SelectOption = { value: string; label: string };
export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { options?: SelectOption[] };
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, options, children, ...rest }, ref) => (
    <select ref={ref} {...rest} className={className}>
        {options ? options.map(option => <option key={option.value} value={option.value}>{option.label}</option>) : children}
    </select>
));
Select.displayName = 'Select';
