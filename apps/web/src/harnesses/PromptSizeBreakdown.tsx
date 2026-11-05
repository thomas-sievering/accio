import type { PromptMeasurement } from '@accio/protocol';

export function promptTotals(measurement: PromptMeasurement) {
  return [measurement.harness, measurement.accio, measurement.additional, measurement.context ?? { characters: 0, estimatedTokens: 0 }, measurement.tools].reduce((total, part) => ({
    characters: total.characters + part.characters, estimatedTokens: total.estimatedTokens + part.estimatedTokens,
  }), { characters: 0, estimatedTokens: 0 });
}

/** The same units and scope in Settings and the thread's last-request popover. */
export function PromptSizeBreakdown({ measurement }: { measurement: PromptMeasurement }) {
  const total = promptTotals(measurement);
  return <>
    <table className="prompt-size-table">
      <thead><tr><th>Instructions and tools</th><th>Est. tokens</th><th>Characters</th></tr></thead>
      <tbody>
        {([
          ['Harness / other instructions', measurement.harness],
          ['Accio prompt', measurement.accio],
          ['Added turn instructions', measurement.additional],
          ['Project / environment context', measurement.context ?? { characters: 0, estimatedTokens: 0 }],
          [`Tool definitions (${measurement.toolCount})`, measurement.tools],
          ['Total', total],
        ] as const).map(([label, size]) => <tr key={label}><th scope="row">{label}</th><td>{size.estimatedTokens.toLocaleString()}</td><td>{size.characters.toLocaleString()}</td></tr>)}
      </tbody>
    </table>
    <p className="note">Tokens are rough estimates: one per four characters, not provider counts. Characters count instruction text, recognized project/environment context and serialized tool definitions. Conversation, images and unrecognized context formats are excluded.</p>
    <p className="note">{measurement.model && <>Model: {measurement.model}. </>}Measured {new Date(measurement.at).toLocaleString()}.</p>
  </>;
}
