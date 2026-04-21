import type { FormEvent } from "react";
import { Eye, EyeOff, Pencil } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../app/AppState";
import { AppShell, PageHeading } from "../components/shell";
import {
  BackLink,
  Button,
  Stepper,
  TextField,
} from "../components/ui";
import { ThresholdSelector } from "../components/ThresholdSelector";
import { useDemoUi } from "../demo/demoUi";
import { generateNsec } from "../lib/bifrost/packageService";
import type { GeneratedNsecResult } from "../lib/bifrost/types";

export function CreateKeysetScreen() {
  const navigate = useNavigate();
  const { createKeyset } = useAppState();
  const demoUi = useDemoUi();
  const [groupName, setGroupName] = useState(
    demoUi.create?.keysetNamePreset ?? "My Signing Key",
  );
  const [nsec, setNsec] = useState(
    demoUi.create?.nsecPreset ??
      (demoUi.create?.validationError ? "not-a-valid-key" : ""),
  );
  const [threshold, setThreshold] = useState(2);
  const [count, setCount] = useState(3);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    groupName?: string;
    nsec?: string;
  }>(
    demoUi.create?.validationError
      ? { nsec: "Existing nsec splitting is not supported yet." }
      : {},
  );
  const [busy, setBusy] = useState(false);
  const [generatedNsec, setGeneratedNsec] =
    useState<GeneratedNsecResult | null>(null);
  const [showNsec, setShowNsec] = useState(false);
  const [generatingNsec, setGeneratingNsec] = useState(false);

  async function handleGenerateNsec() {
    setGeneratingNsec(true);
    setError("");
    setFieldErrors((prev) => ({ ...prev, nsec: undefined }));
    try {
      const result = await generateNsec();
      setNsec(result.nsec);
      setGeneratedNsec(result);
      setShowNsec(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate nsec.");
    } finally {
      setGeneratingNsec(false);
    }
  }

  function clearGeneratedNsec() {
    setGeneratedNsec(null);
    setShowNsec(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const errors: { groupName?: string; nsec?: string } = {};
    if (!groupName.trim()) {
      errors.groupName = "Keyset name is required.";
    }
    const generatedValue = generatedNsec?.nsec ?? "";
    const isExistingNsec = nsec.trim() && nsec.trim() !== generatedValue;
    if (isExistingNsec && !nsec.trim().startsWith("nsec1")) {
      errors.nsec = "Invalid nsec format — must start with nsec1.";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setBusy(false);
      return;
    }

    setFieldErrors({});
    try {
      await createKeyset({
        groupName,
        threshold,
        count,
        generatedNsec: generatedNsec?.nsec,
        existingNsec: isExistingNsec ? nsec.trim() : undefined,
      });
      clearGeneratedNsec();
      navigate("/create/progress");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create keyset.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell mainVariant="flow">
      <form className="screen-column" onSubmit={submit}>
        <Stepper current={1} variant="create" />
        <BackLink
          onClick={() => {
            clearGeneratedNsec();
            navigate("/");
          }}
        />
        <PageHeading
          title="Create New Keyset"
          copy="Define the group profile for a new keyset. After creation, you'll create the local profile and distribute shares to the remaining devices."
        />
        <TextField
          label="Keyset Name"
          placeholder="e.g. My Signing Key, Work Key..."
          value={groupName}
          onChange={(event) => {
            setGroupName(event.target.value);
            if (fieldErrors.groupName)
              setFieldErrors((prev) => ({ ...prev, groupName: undefined }));
          }}
          leading={<Pencil size={16} />}
          help="A friendly name for this keyset's group profile. Visible to all peers in the keyset."
          error={fieldErrors.groupName}
        />
        <div className="field">
          <span className="label">Private Key (nsec)</span>
          <div className="private-key-row">
            <span className="input-shell">
              <input
                className={`input${fieldErrors.nsec ? " input-error" : ""}`}
              placeholder="Paste your existing nsec or generate a new one"
              type={showNsec ? "text" : "password"}
              value={nsec}
              onChange={(event) => {
                const next = event.target.value;
                setNsec(next);
                if (generatedNsec && next !== generatedNsec.nsec)
                  clearGeneratedNsec();
                if (fieldErrors.nsec)
                  setFieldErrors((prev) => ({ ...prev, nsec: undefined }));
              }}
            />
            <button
              type="button"
              className="password-toggle"
              aria-label={showNsec ? "Hide nsec" : "Reveal nsec"}
              onClick={() => setShowNsec((shown) => !shown)}
              disabled={!nsec}
            >
              {showNsec ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
          <Button
            type="button"
            variant="secondary"
            disabled={generatingNsec || busy}
            onClick={handleGenerateNsec}
          >
            {generatingNsec ? "Generating..." : "Generate"}
          </Button>
          </div>
          {fieldErrors.nsec ? (
            <span className="field-error-text">{fieldErrors.nsec}</span>
          ) : (
            <span className="help">
              Paste your existing nsec or leave blank to generate a new one
            </span>
          )}
        </div>
        <ThresholdSelector
          threshold={threshold}
          total={count}
          onThresholdChange={setThreshold}
          onTotalChange={(next) => {
            setCount(next);
            if (threshold > next) {
              setThreshold(next);
            }
          }}
          help={`Any ${threshold} of ${count} shares can sign — min threshold is 2, min shares is ${threshold}`}
        />
        {error ? <div className="error">{error}</div> : null}
        <Button type="submit" size="full" disabled={busy}>
          {busy ? "Creating..." : "Create Keyset"}
        </Button>
      </form>
    </AppShell>
  );
}
