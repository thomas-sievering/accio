/**
 * accio/busy-button: a button whose label is swapped by hand while busy, as
 * `busy ? 'Saving…' : 'Save'`, gets `disabled` and fades out, which reads as unavailable rather
 * than working. `Button` from apps/web/src/ui/Button.tsx shows the wait instead (AGENTS.md,
 * "Waiting on an action"). Flags a conditional on a `busy` value with an "-ing…" branch inside
 * a <button>, or in a `*Label` prop such as SettingsFooter's `saveLabel`.
 */
const WAITING = /ing(…|\.\.\.)$/;

const mentionsBusy = (node) => {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'Identifier') return /busy$/i.test(node.name);
  if (node.type === 'MemberExpression') return mentionsBusy(node.property) || mentionsBusy(node.object);
  if (node.type === 'UnaryExpression') return mentionsBusy(node.argument);
  if (node.type === 'LogicalExpression' || node.type === 'BinaryExpression') return mentionsBusy(node.left) || mentionsBusy(node.right);
  return false;
};

const text = (node) => {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral') return node.quasis.at(-1)?.value.cooked ?? '';
  return undefined;
};

const inButtonOrLabel = (node) => {
  for (let at = node.parent; at; at = at.parent) {
    if (at.type === 'JSXAttribute' && /Label$/.test(at.name.name)) return true;
    if (at.type === 'JSXElement' && at.openingElement.name.type === 'JSXIdentifier' && at.openingElement.name.name === 'button') return true;
  }
  return false;
};

export default {
  meta: {
    type: 'suggestion',
    docs: { description: 'Show a pending action with <Button busy busyLabel>, not a hand-made label' },
    schema: [],
    messages: {
      useButton: 'A hand-made "{{label}}" fades the button instead of showing it at work. Use <Button busy={…} busyLabel="{{label}}"> from ui/Button (AGENTS.md, "Waiting on an action").',
    },
  },
  create(context) {
    return {
      ConditionalExpression(node) {
        if (!mentionsBusy(node.test)) return;
        const label = [node.consequent, node.alternate].map(text).find((t) => t !== undefined && WAITING.test(t));
        if (label && inButtonOrLabel(node)) context.report({ node, messageId: 'useButton', data: { label } });
      },
    };
  },
};
