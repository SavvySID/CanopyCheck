import { bpsToPct, fmt } from '../util.js';
import { Card, Hash, StatusChip } from '../ui.jsx';

const ACTION_LABELS = {
  Issued: 'Credits issued',
  Transfer: 'Transfer',
  Retired: 'Retirement',
  TransferBlocked: 'Transfer attempt',
  RetireBlocked: 'Retirement attempt',
  DuplicateRegistrationBlocked: 'Duplicate registration attempt',
};

// "Checker A (university lab)" -> { short: "Checker A", role: "university lab" }
function checkerLabel(name = '') {
  const m = /^(.*?)\s*\((.*)\)$/.exec(name);
  return m ? { short: m[1], role: m[2] } : { short: name, role: '' };
}

// Mirrors CanopyCheck.submitReport: a report agrees when both values are within the
// tolerance of the report that reached quorum. Derived from the submitted values rather
// than from the replay script's labels.
function outcomeFor(sub, check, toleranceBps) {
  const accepting = check.submissions.find((s) => s.tx === check.finalizeTx);
  if (!accepting) return 'pending';
  const within = (a, b) => Math.abs(a - b) <= toleranceBps;
  return within(sub.coverBps, accepting.coverBps) && within(sub.refLossBps, accepting.refLossBps) ? 'agreed' : 'outlier';
}

function Outcome({ value }) {
  return <span className={`outcome outcome-${value}`}>{value === 'agreed' ? 'agrees' : value}</span>;
}

export default function ChainCard({ chain, chainState, project, chainProject }) {
  if (chainState === 'loading') {
    return (
      <Card kicker="Verification & audit trail" title="Loading on-chain records…">
        <p className="muted">Reading the checker submissions and credit actions for this build.</p>
      </Card>
    );
  }
  if (chainState === 'missing' || !chain) {
    return (
      <Card kicker="Verification & audit trail" title="Not generated yet">
        <p className="muted">
          On-chain results for this build haven't been generated. Run <code>npm run checks</code> to deploy the contracts, replay the checker
          submissions and write <code>data/chain.json</code>.
        </p>
      </Card>
    );
  }
  if (!chainProject) {
    return (
      <Card kicker="Verification & audit trail" title="Not registered">
        <p className="muted">{project.name} has not been registered on-chain in this demo.</p>
      </Card>
    );
  }

  const { chainId } = chain;
  const checkers = chain.checkers ?? [];
  const total = checkers.length || 3;
  const checks = chainProject.checks ?? [];
  const submissionCount = checks.reduce((n, c) => n + (c.submissions?.length ?? 0), 0);
  let previous = 'Healthy'; // projects are registered as Healthy at their baseline measurement

  return (
    <Card kicker="Verification & audit trail" title="Checker consensus and credit actions" actions={<StatusChip status={chainProject.status} />}>
      <dl className="kv">
        <div><dt>Network</dt><dd>{chain.network} · chain {chainId}</dd></div>
        <div><dt>Contract</dt><dd><Hash value={chain.contract} chainId={chainId} kind="address" head={10} tail={8} /></dd></div>
        <div><dt>Project ID</dt><dd>#{chainProject.onchainId} · registered in <Hash value={chainProject.registerTx} chainId={chainId} /></dd></div>
        <div><dt>Boundary hash</dt><dd><Hash value={chainProject.boundaryHash} kind="none" /></dd></div>
        <div><dt>Baseline cover</dt><dd>{bpsToPct(chainProject.baselineCoverBps)}</dd></div>
        <div><dt>Claimed threat</dt><dd>{bpsToPct(chainProject.claimedThreatBps)} per year</dd></div>
        <div><dt>Credits</dt><dd>{fmt(chainProject.issued)} issued · {fmt(chainProject.retired)} retired</dd></div>
      </dl>

      <div className="rule-box">
        <b>Consensus rule:</b> a yearly measurement is accepted when {chain.quorum} of {total} registered checkers agree within ±
        {bpsToPct(chain.toleranceBps)} on forest cover and reference-area loss. The lowest agreeing value is recorded, and an outlier is ignored.
      </div>

      <h3 className="sub-head">Checker submissions by period</h3>
      {checks.length ? (
        <>
          <div className="table-wrap">
            <table className="data-table rtable consensus-table">
              <thead>
                <tr>
                  <th>Period</th>
                  {checkers.map((k) => <th key={k.address} title={k.name}>{checkerLabel(k.name).short}</th>)}
                  <th>Consensus and status</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((c) => {
                  const from = previous;
                  previous = c.statusAfter ?? previous;
                  const agreeing = c.submissions.filter((s) => outcomeFor(s, c, chain.toleranceBps) === 'agreed').length;
                  const accepting = c.submissions.find((s) => s.tx === c.finalizeTx);
                  return (
                    <tr key={c.period}>
                      <td data-label="Period"><b>{c.period}</b></td>
                      {checkers.map((k) => {
                        const sub = c.submissions.find((s) => s.checker === k.address);
                        return (
                          <td key={k.address} data-label={checkerLabel(k.name).short}>
                            {sub ? (
                              <span className="vote">
                                <span className="vote-value">{bpsToPct(sub.coverBps)}</span>
                                <Outcome value={outcomeFor(sub, c, chain.toleranceBps)} />
                              </span>
                            ) : (
                              <span className="muted">no report</span>
                            )}
                          </td>
                        );
                      })}
                      <td data-label="Consensus">
                        {c.acceptedCoverBps != null ? (
                          <div className="consensus">
                            <div><b>{agreeing} of {c.submissions.length}</b> agree · accepted <b>{bpsToPct(c.acceptedCoverBps)}</b></div>
                            <span className="transition">
                              <StatusChip status={from} small /> <span aria-hidden="true">→</span> <StatusChip status={c.statusAfter ?? from} small />
                            </span>
                            <div className="small muted">
                              block {accepting?.block ?? '—'} · <Hash value={c.finalizeTx} chainId={chainId} head={6} tail={4} />
                            </div>
                          </div>
                        ) : (
                          <span className="muted">no quorum yet</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="source-note">
            {checkers.map((k) => `${checkerLabel(k.name).short}: ${checkerLabel(k.name).role || k.name}`).join(' · ')}. Checker C deliberately reports
            inflated forest cover in this demo to show the quorum rejecting an outlier.
          </p>
          <details className="data-details">
            <summary>All {submissionCount} submissions with transaction hashes</summary>
            <div className="table-wrap">
              <table className="data-table rtable">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Checker</th>
                    <th>Forest cover</th>
                    <th>Ref. loss/yr</th>
                    <th>Result</th>
                    <th>Block</th>
                    <th>Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {checks.flatMap((c) =>
                    c.submissions.map((s) => (
                      <tr key={s.tx ?? `${c.period}-${s.checker}`}>
                        <td data-label="Period">{c.period}</td>
                        <td data-label="Checker">
                          <div>{s.name}</div>
                          <Hash value={s.checker} chainId={chainId} kind="address" head={6} tail={4} />
                        </td>
                        <td data-label="Forest cover">{bpsToPct(s.coverBps)}</td>
                        <td data-label="Ref. loss/yr">{bpsToPct(s.refLossBps)}</td>
                        <td data-label="Result"><Outcome value={outcomeFor(s, c, chain.toleranceBps)} /></td>
                        <td data-label="Block">{s.block ?? '—'}</td>
                        <td data-label="Tx"><Hash value={s.tx} chainId={chainId} head={6} tail={4} /></td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p className="muted">No checks submitted yet.</p>
      )}

      <h3 className="sub-head">Credit actions</h3>
      <div className="table-wrap">
        <table className="data-table rtable actions-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Detail</th>
              <th>Result</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {(chainProject.actions ?? []).map((a, i) => {
              const reverted = Boolean(a.revertReason);
              return (
                <tr key={i} className={reverted ? 'row-blocked' : undefined}>
                  <td data-label="Action"><b>{ACTION_LABELS[a.type] ?? a.type}</b></td>
                  <td data-label="Detail" className="muted">{a.detail}</td>
                  <td data-label="Result">
                    {reverted ? (
                      <>
                        <span className="outcome outcome-outlier">reverted</span>
                        <div className="revert"><code>{a.revertReason}</code></div>
                      </>
                    ) : (
                      <span className="outcome outcome-agreed">executed</span>
                    )}
                  </td>
                  <td data-label="Tx">{a.tx ? <Hash value={a.tx} chainId={chainId} head={6} tail={4} /> : <span className="muted">none (reverted)</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
