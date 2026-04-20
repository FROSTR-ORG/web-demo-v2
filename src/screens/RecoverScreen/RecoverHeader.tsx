export function RecoverHeader({ keysetName }: { keysetName: string }) {
  return (
    <div className="recover-header-meta">
      <span className="recover-header-keyset">{keysetName}</span>
    </div>
  );
}
