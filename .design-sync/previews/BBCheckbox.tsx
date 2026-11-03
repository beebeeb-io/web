// Design-sync preview of BBCheckbox for the Claude Design project.
import { useState } from 'react'
import { BBCheckbox } from '@beebeeb/shared'

export const States = () => (
  <div className="flex flex-col gap-3 bg-paper p-4">
    <BBCheckbox checked={false} onChange={() => {}} label="Not selected" />
    <BBCheckbox checked onChange={() => {}} label="Selected" />
    <BBCheckbox checked={false} indeterminate onChange={() => {}} label="Some files selected" />
  </div>
)

export const Consent = () => {
  const [saved, setSaved] = useState(false)
  return (
    <div className="flex w-80 flex-col gap-3 bg-paper p-4">
      <BBCheckbox checked={saved} onChange={setSaved} label="I have saved my recovery phrase offline." />
    </div>
  )
}

export const Dark = () => (
  <div className="dark flex flex-col gap-3 bg-paper p-4">
    <BBCheckbox checked={false} onChange={() => {}} label="Not selected" />
    <BBCheckbox checked onChange={() => {}} label="Selected" />
    <BBCheckbox checked={false} indeterminate onChange={() => {}} label="Some files selected" />
  </div>
)
