"use client";

import { useActionState, useState } from "react";
import { saveDriveConfigAndScan, testDriveConnection, type SaveResult, type TestResult } from "./actions";
import { Alert, buttonClass, inputClass, labelClass } from "@/components/ui";

const idleTest: TestResult = { status: "idle" };
const idleSave: SaveResult = { status: "idle" };

export function DriveConnectionForm({
  disabled,
  defaults,
}: {
  disabled: boolean;
  defaults: { sharedDriveId: string; pollInterval: number; excludedFolders: string };
}) {
  const [testState, testAction, testing] = useActionState(testDriveConnection, idleTest);
  const [saveState, saveAction, saving] = useActionState(saveDriveConfigAndScan, idleSave);
  const [sharedDrive, setSharedDrive] = useState(defaults.sharedDriveId);
  const errors = saveState.status === "error" ? saveState.fieldErrors ?? {} : {};
  const tested = testState.status === "success";

  return (
    <form action={saveAction} className="space-y-4">
      <div>
        <label htmlFor="shared_drive" className={labelClass}>Shared Drive ID or URL</label>
        <input
          id="shared_drive"
          name="shared_drive"
          value={sharedDrive}
          onChange={(e) => setSharedDrive(e.target.value)}
          required
          disabled={disabled}
          placeholder="https://drive.google.com/drive/folders/0AB…"
          className={`${inputClass} mt-1 font-mono`}
          aria-invalid={Boolean(errors.shared_drive)}
        />
        <p className={`mt-1 text-xs ${errors.shared_drive ? "text-red-700" : "text-stone-500"}`}>
          {errors.shared_drive ?? "Open the Shared Drive in Google Drive and copy the address from the browser."}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <label htmlFor="poll_interval_minutes" className={labelClass}>Polling interval (minutes)</label>
          <input
            id="poll_interval_minutes"
            name="poll_interval_minutes"
            type="number"
            min={5}
            max={1440}
            required
            disabled={disabled}
            defaultValue={defaults.pollInterval}
            className={`${inputClass} mt-1`}
          />
          {errors.poll_interval_minutes ? <p className="mt-1 text-xs text-red-700">{errors.poll_interval_minutes}</p> : null}
        </div>
        <div className="md:col-span-2">
          <label htmlFor="excluded_folders" className={labelClass}>Excluded folders</label>
          <textarea
            id="excluded_folders"
            name="excluded_folders"
            rows={3}
            disabled={disabled}
            defaultValue={defaults.excludedFolders}
            placeholder="One folder ID or URL per line, e.g. the temporary OCR folder"
            className={`${inputClass} mt-1 font-mono`}
          />
          <p className={`mt-1 text-xs ${errors.excluded_folders ? "text-red-700" : "text-stone-500"}`}>
            {errors.excluded_folders ?? "Files in these folders and their sub-folders are recorded but never coded."}
          </p>
        </div>
      </div>

      {testState.status === "success" ? (
        <Alert tone="success">
          Connected to <strong>{testState.driveName}</strong> — {testState.itemCount} item{testState.itemCount === 1 ? "" : "s"} (files and folders).
        </Alert>
      ) : null}
      {testState.status === "error" ? <Alert tone="error">{testState.message}</Alert> : null}
      {saveState.status === "error" ? <Alert tone="error">{saveState.message}</Alert> : null}
      {saveState.status === "confirm" ? <Alert tone="warning">{saveState.message}</Alert> : null}
      {saveState.status === "success" ? <Alert tone="success">{saveState.message}</Alert> : null}
      {saveState.status === "confirm" ? <input type="hidden" name="confirm_change" value="yes" /> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          formAction={testAction}
          formNoValidate
          disabled={disabled || testing || !sharedDrive.trim()}
          className={buttonClass.secondary}
        >
          {testing ? "Testing…" : "Test Connection"}
        </button>
        <button type="submit" disabled={disabled || saving || !tested} className={buttonClass.primary}>
          {saving ? "Saving…" : "Save and Start Initial Scan"}
        </button>
      </div>
      {!tested && !disabled ? (
        <p className="text-xs text-stone-500">Test the connection first; the system verifies access before saving.</p>
      ) : null}
      {disabled ? (
        <p className="text-xs text-stone-500">Connect a Google account first. Settings cannot be changed while a scan is running.</p>
      ) : null}
    </form>
  );
}
