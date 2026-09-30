import type { Evidence } from '../../types/domain.ts'
import { cx } from '../ui/primitives.tsx'

/** Multi-select over a case's evidence register. Restricted items stay selectable by id. */
export function EvidencePicker({ evidence, value, onChange, filter, label = 'Supporting evidence' }: { evidence: Array<Evidence & { redacted?: boolean }>; value: string[]; onChange: (ids: string[]) => void; filter?: (e: Evidence) => boolean; label?: string }) {
  const list = filter ? evidence.filter(filter) : evidence
  if (list.length === 0) return <p className="text-xs text-ink-3">No evidence of a matching type on this case yet. Add it on the Evidence tab.</p>
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">{label}</legend>
      <div className="flex max-h-56 min-w-0 flex-col gap-1 overflow-y-auto rounded-lg border border-line bg-s2 p-1.5">
        {list.map((e) => {
          const on = value.includes(e.id)
          return (
            <label key={e.id} className={cx('flex min-w-0 cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors', on ? 'bg-violet-soft' : 'hover:bg-s3')}>
              <input type="checkbox" checked={on} onChange={(ev) => onChange(ev.target.checked ? [...value, e.id] : value.filter((x) => x !== e.id))} className="mt-0.5 accent-[#AE9FE0]" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={cx('mono shrink-0 text-[11px]', on ? 'text-violet' : 'text-ink-3')}>{e.id}</span>
                  <span className="truncate text-xs text-ink">{e.title}</span>
                </span>
                <span className="micro text-ink-4">{e.type.replace(/_/g, ' ')}</span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
