import { capabilities } from "../data/content";
import "./Roadmap.css";

export function Roadmap() {
  return (
    <section id="roadmap" className="section roadmap">
      <div className="wrap">
        <p className="label reveal">
          <span className="label__num">05</span> — Roadmap
        </p>
        <h2 className="display h2 reveal reveal--wipe">Where each piece actually stands.</h2>
        <p className="lede roadmap__lede reveal">
          No layer below is presented as live. “In development” means it is being built and tested; “Planned” means it
          is on the roadmap but not yet built.
        </p>

        <table className="table reveal" role="table">
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader">Capability</th>
              <th scope="col" role="columnheader">Layer</th>
              <th scope="col" role="columnheader">Stack</th>
              <th scope="col" role="columnheader">Status</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {capabilities.map((c) => (
              <tr key={c.code} role="row">
                <th scope="row" role="rowheader" className="display">
                  <span className="table__code">{c.code}</span>
                  {c.title}
                </th>
                <td role="cell" data-label="Layer">{c.layer}</td>
                <td role="cell" data-label="Stack">{c.stack}</td>
                <td role="cell" data-label="Status">
                  <span className={`table__status table__status--${c.status === "Planned" ? "planned" : "dev"}`}>
                    <span aria-hidden="true" />
                    {c.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
