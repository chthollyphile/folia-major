import i18n from '@/i18n/config';
import type { PonderSceneScript, PonderTargetDefinition } from '@/types/ponder';
import type { FoliumLabel } from './contract';
import { resolveFoliumLabel } from '../params/params';

// src/mods/folium/ponderText.ts
// Text in a mod's Ponder target. The host renders every Ponder string through t(key), and a mod has
// no translation keys, so each text field (a plain string, or a FoliumLabel with one string per
// language) is turned into a real key in an i18n namespace of the target's own. That makes mod text
// follow the UI language like host text, and get the same interpolation — `{{mod}}` becomes the
// platform's modifier key. The namespace is removed with the target.
//
// It also fills one default a mod needs: a surface anchor without `surfaceKind` is drawn 'plain'
// (just the frame). The host's own default is the command palette's skeleton, which would put a
// search bar and command rows inside every panel a mod sketches.

/** A mod's text: literal, or per language (`{ 'zh-CN': '…', 'zh-TW': '…', en: '…' }`). */
export type FoliumPonderText = string | FoliumLabel;

type Resources = Record<string, string>;

const isText = (value: unknown): value is FoliumPonderText => (
    typeof value === 'string'
    || (typeof value === 'object' && value !== null && !Array.isArray(value)
        && Object.values(value).some(entry => typeof entry === 'string'))
);

const languages = (): string[] => {
    const supported = i18n.options.supportedLngs;
    return (Array.isArray(supported) ? supported : ['en']).filter(language => language !== 'cimode');
};

/** `folium-ponder/<modid>/<name>`: `:` is i18next's namespace separator, so it cannot appear here. */
export const ponderTextNamespace = (targetId: string) => `folium-ponder/${targetId.replace(':', '/')}`;

/*
 * Rewrites every text field of `input` to a key in `namespace` and collects the text per language.
 * Returns a new definition; the mod's object is not touched. Throws on a text field that is neither
 * a string nor a label.
 */
export const localizePonderTarget = (
    input: Record<string, unknown>,
    namespace: string,
): { target: Omit<PonderTargetDefinition, 'id'>; resources: Record<string, Resources> } => {
    const byLanguage: Record<string, Resources> = Object.fromEntries(languages().map(language => [language, {}]));
    let count = 0;

    const toKey = (value: unknown, field: string): string => {
        if (!isText(value)) throw new Error(`ponder.targets.register: ${field} must be a string or a { language: text } label`);
        const key = `t${count}`;
        count += 1;
        Object.entries(byLanguage).forEach(([language, resources]) => {
            resources[key] = typeof value === 'string' ? value : resolveFoliumLabel(value, language, '');
        });
        return `${namespace}:${key}`;
    };
    const optionalKey = (value: unknown, field: string) => (value === undefined ? undefined : toKey(value, field));

    const scenes = Array.isArray(input.scenes) ? input.scenes as Array<Record<string, unknown>> : [];
    const target = {
        ...input,
        titleKey: toKey(input.titleKey, 'titleKey'),
        summaryKey: optionalKey(input.summaryKey, 'summaryKey'),
        scenes: scenes.map((scene, sceneIndex): PonderSceneScript => {
            const where = `scenes[${sceneIndex}]`;
            const anchors = (scene.anchors ?? {}) as Record<string, Record<string, unknown>>;
            const steps = Array.isArray(scene.steps) ? scene.steps as Array<Record<string, unknown>> : [];
            const action = scene.action as Record<string, unknown> | undefined;
            return {
                ...scene,
                titleKey: toKey(scene.titleKey, `${where}.titleKey`),
                action: action ? { ...action, labelKey: toKey(action.labelKey, `${where}.action.labelKey`) } : undefined,
                anchors: Object.fromEntries(Object.entries(anchors).map(([name, anchor]) => [
                    name,
                    {
                        ...anchor,
                        ...(anchor.labelKey === undefined ? {} : { labelKey: toKey(anchor.labelKey, `${where}.anchors.${name}.labelKey`) }),
                        ...(anchor.role === 'surface' && anchor.surfaceKind === undefined ? { surfaceKind: 'plain' } : {}),
                    },
                ])),
                steps: steps.map((step, stepIndex) => (
                    step.kind === 'caption'
                        ? { ...step, textKey: toKey(step.textKey, `${where}.steps[${stepIndex}].textKey`) }
                        : step
                )),
            } as unknown as PonderSceneScript;
        }),
    } as unknown as Omit<PonderTargetDefinition, 'id'>;
    return { target, resources: byLanguage };
};

export const addPonderText = (namespace: string, resources: Record<string, Resources>) => {
    Object.entries(resources).forEach(([language, entries]) => {
        i18n.addResourceBundle(language, namespace, entries, false, true);
    });
};

export const removePonderText = (namespace: string, resources: Record<string, Resources>) => {
    Object.keys(resources).forEach(language => i18n.removeResourceBundle(language, namespace));
};
