'use client';

import { useState } from 'react';
import { apiFetch, ApiError } from '../../lib/api';
import { Employee, SignatureFont } from '../../lib/types';
import {
  SIGNATURE_FONTS,
  SIGNATURE_FONT_LABEL,
  signatureStyle,
} from '../../lib/signature';
import { Field } from './field';
import { Input } from './input';
import { Select } from './select';
import { Button } from './button';
import { useToast } from './toaster';

/**
 * Shared controlled editor for a signature: a text input, a font picker and a
 * live preview rendering the typed text in the chosen font. Reused by both the
 * profile settings card and the just-in-time inline setup so the picker +
 * preview can't drift between the two.
 */
export function SignatureEditorFields({
  text,
  font,
  onTextChange,
  onFontChange,
  disabled,
}: {
  text: string;
  font: SignatureFont;
  onTextChange: (value: string) => void;
  onFontChange: (value: SignatureFont) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Signature text" htmlFor="signatureText">
          <Input
            id="signatureText"
            maxLength={120}
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder="Your name as you'd sign it"
            disabled={disabled}
          />
        </Field>
        <Field label="Font" htmlFor="signatureFont">
          <Select
            id="signatureFont"
            value={font}
            onChange={(e) => onFontChange(e.target.value as SignatureFont)}
            disabled={disabled}
          >
            {SIGNATURE_FONTS.map((f) => (
              <option key={f} value={f}>
                {SIGNATURE_FONT_LABEL[f]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="rounded-md border bg-muted/30 p-4">
        <div className="text-xs text-muted-foreground">Preview</div>
        <div className="mt-1 text-2xl leading-tight" style={signatureStyle(font)}>
          {text || 'Your signature'}
        </div>
      </div>
    </>
  );
}

/**
 * Just-in-time signature setup shown next to an approval action when the
 * current user has no signature configured yet. Additive — never blocks the
 * approval. Calls back with the updated employee once saved.
 */
export function SignatureSetupInline({
  onSaved,
}: {
  onSaved: (emp: Employee) => void;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [font, setFont] = useState<SignatureFont>(SIGNATURE_FONTS[0]);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!text.trim()) return;
    setSaving(true);
    try {
      const updated = await apiFetch<Employee>('/employees/me/signature', {
        method: 'PATCH',
        body: JSON.stringify({ signatureText: text.trim(), signatureFont: font }),
      });
      toast.success('Signature saved');
      onSaved(updated);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to save signature',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 rounded-md border border-dashed p-4">
      <p className="text-sm font-medium">
        Set up your signature to complete this approval
      </p>
      <SignatureEditorFields
        text={text}
        font={font}
        onTextChange={setText}
        onFontChange={setFont}
        disabled={saving}
      />
      <Button onClick={save} disabled={saving || !text.trim()}>
        {saving ? 'Saving…' : 'Save signature'}
      </Button>
    </div>
  );
}
