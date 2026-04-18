import type { FormEvent } from "react";
import { EyeOff } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../app/AppState";
import { AppShell, PageHeading } from "../components/shell";
import { BackLink, Button, NumberStepper, Stepper, TextField } from "../components/ui";

export function CreateKeysetScreen() {
  const navigate = useNavigate();
  const { createKeyset } = useAppState();
  const [groupName, setGroupName] = useState("My Signing Key");
  const [threshold, setThreshold] = useState(2);
  const [count, setCount] = useState(3);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await createKeyset({ groupName, threshold, count });
      navigate("/create/profile");
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
        <BackLink onClick={() => navigate("/")} />
        <PageHeading
          title="Create New Keyset"
          copy="Define the group profile for a new keyset. After creation, you'll create the local profile and distribute shares to the remaining devices."
        />
        <TextField
          label="Keyset Name"
          placeholder="e.g. My Signing Key, Work Key..."
          value={groupName}
          onChange={(event) => setGroupName(event.target.value)}
          help="A friendly name for this keyset's group profile. Visible to all peers in the keyset."
        />
        <div className="field">
          <span className="label">Private Key (nsec)</span>
          <div className="private-key-row">
            <span className="input-shell">
              <input className="input" placeholder="Paste your existing nsec or generate a new one" readOnly />
              <span className="input-trailing">
                <EyeOff size={16} />
              </span>
            </span>
            <Button type="button" variant="secondary" title="A fresh key is generated when you create the keyset.">
              Generate
            </Button>
          </div>
          <span className="help">Paste your existing nsec or leave blank to generate a new one.</span>
        </div>
        <div className="field-row">
          <NumberStepper label="Threshold" value={threshold} min={2} max={count} onChange={setThreshold} />
          <div className="divider-text">/</div>
          <NumberStepper
            label="Total Shares"
            value={count}
            min={3}
            max={10}
            onChange={(next) => {
              setCount(next);
              if (threshold > next) {
                setThreshold(next);
              }
            }}
          />
        </div>
        <div className="help">
          Any {threshold} of {count} shares can sign - min threshold is 2, min shares is 3.
        </div>
        {error ? <div className="error">{error}</div> : null}
        <Button type="submit" size="full" disabled={busy}>
          {busy ? "Creating..." : "Create Keyset"}
        </Button>
      </form>
    </AppShell>
  );
}
