import { describe, expect, it } from 'vitest';
import { drivingModel, imageReply, imageRoute, readImageRequest, responsesBody } from './images.js';
import { FAKE_IMAGE, imageGenerationReply, responsesReply } from './testing/fakeProviders.js';

const json = (value: unknown) => Buffer.from(JSON.stringify(value));
const model = (id: string, extra: object = {}) => ({ id, name: id, description: '', isDefault: false, ...extra });

describe('image routes', () => {
  it('answers OpenAI’s Images API paths, with or without /v1', () => {
    expect(imageRoute('/openai/images/generations')).toBe('generations');
    expect(imageRoute('/openai/v1/images/edits')).toBe('edits');
    expect(imageRoute('/openai/images/variations')).toBeUndefined();
    expect(imageRoute('/openai/responses')).toBeUndefined();
  });
});

describe('readImageRequest', () => {
  it('reads a generation with its options and an edit with its reference images', () => {
    expect(readImageRequest(json({ model: 'gpt-image-1', prompt: 'A fox', size: '1024x1536', quality: 'high', background: 'transparent', n: 1 }), 'generations'))
      .toEqual({ prompt: 'A fox', images: [], size: '1024x1536', quality: 'high', background: 'transparent', outputFormat: 'png' });
    expect(readImageRequest(json({ prompt: 'Make it green', images: [{ image_url: 'data:image/png;base64,AAAA' }], output_format: 'webp', output_compression: 80 }), 'edits'))
      .toEqual({ prompt: 'Make it green', images: ['data:image/png;base64,AAAA'], outputFormat: 'webp', outputCompression: 80 });
    expect(readImageRequest(json({ prompt: 'x', image: 'https://example.com/a.png' }), 'edits').images).toEqual(['https://example.com/a.png']);
  });

  it('refuses what it cannot do, naming the parameter', () => {
    const refused = (body: unknown, route: 'generations' | 'edits' = 'generations') => {
      try { readImageRequest(Buffer.isBuffer(body) ? body : json(body), route); } catch (error) { return { message: (error as Error).message, param: (error as { param?: string }).param }; }
      throw new Error('accepted');
    };
    expect(refused(Buffer.from('--boundary\r\nContent-Disposition: form-data'))).toMatchObject({ message: expect.stringContaining('JSON') });
    expect(refused({})).toMatchObject({ param: 'prompt' });
    expect(refused({ prompt: 'x', n: 2 })).toMatchObject({ param: 'n' });
    expect(refused({ prompt: 'x', response_format: 'url' })).toMatchObject({ param: 'response_format' });
    expect(refused({ prompt: 'x', quality: 'ultra' })).toMatchObject({ param: 'quality' });
    expect(refused({ prompt: 'x', size: 'big' })).toMatchObject({ param: 'size' });
    expect(refused({ prompt: 'x', mask: { image_url: 'data:image/png;base64,AA' } }, 'edits')).toMatchObject({ param: 'mask' });
    expect(refused({ prompt: 'x' }, 'edits')).toMatchObject({ param: 'images' });
    expect(refused({ prompt: 'x', images: [{ file_id: 'file_1' }] }, 'edits')).toMatchObject({ param: 'images' });
    expect(refused({ prompt: 'x', images: ['http://example.com/a.png'] }, 'edits')).toMatchObject({ param: 'images' });
  });
});

describe('drivingModel', () => {
  it('picks a small model at its lowest effort, else the default, else the first', () => {
    expect(drivingModel([model('gpt-6-sol', { isDefault: true }), model('gpt-5.6-luna', { efforts: [{ id: 'low' }, { id: 'high' }] })])).toEqual({ id: 'gpt-5.6-luna', effort: 'low' });
    expect(drivingModel([model('gpt-6-terra'), model('gpt-6-sol', { isDefault: true })])).toEqual({ id: 'gpt-6-sol' });
    expect(drivingModel([model('gpt-6-terra')])).toEqual({ id: 'gpt-6-terra' });
    expect(drivingModel([])).toBeUndefined();
  });
});

describe('responsesBody', () => {
  it('requires the image tool, with the reference images before the prompt', () => {
    const body = responsesBody({ prompt: 'Make it green', images: ['data:image/png;base64,AAAA'], size: '1024x1024', outputFormat: 'png' }, { id: 'gpt-luna', effort: 'low' });
    expect(body).toMatchObject({
      model: 'gpt-luna', stream: true, store: false, reasoning: { effort: 'low' }, tool_choice: { type: 'image_generation' },
      tools: [{ type: 'image_generation', output_format: 'png', size: '1024x1024', action: 'edit' }],
      input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,AAAA' }, { type: 'input_text', text: 'Make it green' }] }],
    });
    expect(responsesBody({ prompt: 'A fox', images: [], outputFormat: 'png' }, { id: 'gpt-luna' }).tools[0]).toEqual({ type: 'image_generation', output_format: 'png' });
  });
});

describe('imageReply', () => {
  it('answers in the Images API’s shape, with the image tool’s usage', () => {
    expect(imageReply(imageGenerationReply('A fox'), 1_700_000_000_000)).toEqual({ ok: true, body: {
      created: 1_700_000_000, data: [{ b64_json: FAKE_IMAGE.toString('base64'), revised_prompt: 'A fox' }],
      size: '1024x1024', quality: 'low', background: 'opaque', output_format: 'png',
      usage: { input_tokens: 7, output_tokens: 300, total_tokens: 307, input_tokens_details: { text_tokens: 7, image_tokens: 0 } },
    } });
  });

  it('says why when there is no image', () => {
    expect(imageReply(responsesReply('I can’t make that image.'))).toEqual({ ok: false, message: 'ChatGPT made no image: I can’t make that image.' });
    const failed = `event: response.failed\ndata: ${JSON.stringify({ type: 'response.failed', response: { error: { message: 'Blocked by safety system' } } })}\n\n`;
    expect(imageReply(failed)).toEqual({ ok: false, message: 'Blocked by safety system' });
    expect(imageReply('')).toEqual({ ok: false, message: 'ChatGPT made no image.' });
  });
});
