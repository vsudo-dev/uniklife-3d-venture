import { PROPERTY_TYPES } from "@/lib/viewer-settings";

/**
 * Filter field for the plot inventory GET form (`propertyType` query param).
 * Matches the plot's effective property type (its own, else the venture's).
 */
export function PropertyTypeFilterField({ defaultValue }: { defaultValue?: string }) {
  return (
    <div>
      <label className="label" htmlFor="f-ptype">Property type</label>
      <select id="f-ptype" name="propertyType" defaultValue={defaultValue ?? ""} className="input">
        <option value="">All</option>
        {PROPERTY_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
    </div>
  );
}

export function propertyTypeLabel(id: string | null | undefined): string {
  return PROPERTY_TYPES.find((t) => t.id === id)?.label ?? (id ? String(id) : "—");
}
