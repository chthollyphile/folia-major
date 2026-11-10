import { describe, expect, it } from 'vitest';
import { AI_TASKS, budgetFor } from '../../../shared/ai/aiTasks.mjs';
import { AI_ADAPTERS, DEFAULT_GEMINI_MODEL, type AiAdapter } from '../../../shared/ai/providerRegistry.mjs';
import { SEGMENTATION_GEMINI_GENERATION_CONFIG } from '../../../shared/lyricSegmentationPrompt.mjs';
import { ANSWER_TOKENS, answered, capOf, exhaustedReply, firstBody, rejectedWith, requestsFor, simulate, type AiTask } from './adapterHarness';

// test/unit/ai/adapterInvariants.test.ts
// Rules every adapter keeps whatever its provider's own rules are. Each provider's specific
// requests are pinned in its own test/unit/ai/<id>Adapter.test.ts (see adapterHarness.ts).

/** The models each adapter is checked with: its default and recommended ones, and an unknown one. */
const modelsOf = (adapter: AiAdapter) => [...new Set([
    adapter.defaultModel ?? 'some-model',
    adapter.recommendedModel ?? 'some-model',
    'unknown-model-x',
])];

const cases = AI_ADAPTERS.flatMap(adapter => (AI_TASKS as readonly AiTask[]).flatMap(task => (
    modelsOf(adapter).map(model => [adapter.id, task, model, adapter] as const)
)));

describe.each(cases)('%s %s %s', (_id, task, model, adapter) => {
    const requests = requestsFor(adapter, task, model);

    it('has at least one attempt, each with a label', () => {
        expect(requests.length).toBeGreaterThan(0);
        for (const { attempt } of requests) {
            expect(attempt.label).toBeTruthy();
        }
    });

    it('sends the cap budgetFor gives, in the adapter\'s token field', () => {
        for (const { attempt, budget, body } of requests) {
            expect(budget).toBe(budgetFor(task, ANSWER_TOKENS[task], attempt));
            expect(capOf(adapter, body)).toBe(budget);
        }
    });

    it('moves on only for knobs the attempt actually sends', () => {
        for (const { attempt, body } of requests) {
            const sent = adapter.protocol === 'gemini'
                ? (body.generationConfig?.thinkingConfig ? ['thinkingConfig'] : [])
                : Object.keys(body);
            for (const knob of attempt.knobs) {
                expect(sent, `${attempt.label} knob ${knob}`).toContain(knob);
            }
        }
    });

    it('keeps the temperature inside the adapter\'s range, or sends none', () => {
        for (const { body } of requests) {
            if (adapter.temperature === null) {
                expect(body.temperature).toBeUndefined();
            } else if (body.temperature !== undefined) {
                expect(body.temperature).toBeGreaterThanOrEqual(adapter.temperature.min);
                expect(body.temperature).toBeLessThanOrEqual(adapter.temperature.max);
            }
        }
        const hot = requestsFor(adapter, task, model, { temperature: 1.99 });
        for (const { body } of hot) {
            if (body.temperature !== undefined && adapter.temperature) {
                expect(body.temperature).toBeLessThanOrEqual(adapter.temperature.max);
            }
        }
    });

    it('streams only when the adapter offers it', () => {
        const body = firstBody(adapter, task, model, { stream: true });
        expect(body.stream === true).toBe(adapter.protocol === 'openai' && adapter.stream);
    });

    if (adapter.protocol === 'gemini') {
        it('never sends a thinking level and a thinking budget together', () => {
            for (const { body } of requests) {
                const thinking = body.generationConfig?.thinkingConfig ?? {};
                expect('thinkingLevel' in thinking && 'thinkingBudget' in thinking).toBe(false);
            }
        });
    }
});

describe('regression anchors', () => {
    it('builds the measured segmentation config for the default Gemini model', () => {
        expect(firstBody('gemini', 'segmentation', DEFAULT_GEMINI_MODEL).generationConfig).toEqual(SEGMENTATION_GEMINI_GENERATION_CONFIG);
    });

    it('lets the custom adapter keep the generic three-rung ladder for segmentation', () => {
        expect(requestsFor('custom', 'segmentation', 'any').map(({ attempt, budget }) => [attempt.label, budget])).toEqual([
            ['reasoning_effort', 8192],
            ['chat_template_kwargs', 8192],
            ['plain', 8192 * 4],
        ]);
    });

    it('walks the custom ladder down on a named rejection and on exhausted reasoning, as the harness simulates it', async () => {
        const { bodies, outcome } = await simulate('custom', 'segmentation', 'any', (_body, index) => (
            index === 0 ? rejectedWith(400, { error: { message: 'Bad', param: 'reasoning_effort', code: 'invalid_value' } })
                : index === 1 ? exhaustedReply()
                    : answered('{"lines":[]}')
        ));
        expect(bodies.map(body => Object.keys(body).filter(key => key === 'reasoning_effort' || key === 'chat_template_kwargs')))
            .toEqual([['reasoning_effort'], ['chat_template_kwargs'], []]);
        expect(outcome).toMatchObject({ index: 2, result: { content: '{"lines":[]}' } });
    });
});
