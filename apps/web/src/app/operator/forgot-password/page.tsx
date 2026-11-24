'use client';

import { Button, Card, CardContent, CardHeader, Input } from '@dealflow/ui';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';

/** Asks for an operator password reset link (ADR 0074). The answer is the same whether or not the account exists. */
export default function OperatorForgotPassword() {
  const [email, setEmail] = useState('');
  const send = useMutation({ mutationFn: () => api('/operator/password/forgot', { method: 'POST', json: { email } }) });
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <h1 className="text-lg font-semibold">Reset your Console password</h1>
        </CardHeader>
        <CardContent>
          {send.isSuccess ? (
            <div className="space-y-3 text-sm" role="status">
              <p>If {email} has a Console account, a reset link is on its way. It works for one hour.</p>
              <p className="text-muted-foreground">No email? A Super Admin can send you a reset link from the Operators page.</p>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                send.mutate();
              }}
            >
              <Field id="fp-email" label="Email">
                <Input id="fp-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </Field>
              <ErrorText error={send.error} />
              <Button type="submit" className="w-full" disabled={send.isPending}>
                Send reset link
              </Button>
            </form>
          )}
          <Link href="/operator/login" className="mt-4 inline-block text-sm text-primary underline-offset-2 hover:underline">
            Back to sign-in
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
