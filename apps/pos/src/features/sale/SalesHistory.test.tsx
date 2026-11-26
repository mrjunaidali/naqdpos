import { businessDate, nextDate, previousDay, type SaleRow } from '@naqdpos/core';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db/schema.ts';
import { formatDate } from '../../i18n/format.ts';
import { i18n } from '../../i18n/index.ts';
import { writeCurrentStaffId } from '../../staff/currentStaff.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { DEVICE_ID, resetDb, SHOP_ID, seedReady, STAFF_ID, staffRow } from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';

vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));

const CASHIER = '019a9b8e-0000-7000-8000-0000000000c2';
const TODAY = businessDate(new Date());
const YESTERDAY = previousDay(TODAY);
const FIVE_AGO = [1, 2, 3, 4, 5].reduce((d) => previousDay(d), TODAY);
const WEEK_FROM = [...Array(6).keys()].reduce((d) => previousDay(d), TODAY);
const TEN_AGO = [...Array(10).keys()].reduce((d) => previousDay(d), TODAY);
const en = (iso: string) => formatDate(iso, i18n.getFixedT('en'));

let n = 0;
async function sale(date: string, total: number, staff = STAFF_ID): Promise<SaleRow> {
  n += 1;
  const row: SaleRow = {
    // UUIDv7-like ids that sort by creation order.
    id: `019a9b8e-0000-7000-8000-${String(n).padStart(12, '0')}`,
    shop_id: SHOP_ID,
    receipt_no: `A1-${String(n).padStart(6, '0')}`,
    business_date: date,
    staff_id: staff,
    customer_id: null,
    order_type: 'walk_in',
    source: 'walk_in',
    subtotal_paisa: total,
    discount_paisa: 0,
    rounding_paisa: 0,
    total_paisa: total,
    note: null,
    discount_approved_by_staff_id: null,
    created_at: `${date}T07:00:00.000Z`,
    device_id: DEVICE_ID,
    server_seq: null,
  };
  await db.sales.put(row);
  return row;
}

beforeEach(async () => {
  resetApiMock();
  await resetDb();
  await seedReady('shop');
  await db.staff.put(
    staffRow({ id: CASHIER, name: 'Bilal', role: 'cashier', membership_user_id: null }),
  );
  await writeCurrentStaffId(STAFF_ID);
});
afterEach(async () => {
  await i18n.changeLanguage('en');
});

const heading = () => screen.findByRole('heading', { level: 1 });
const receipts = () =>
  screen.queryAllByRole('link').filter((a) => /^A1-/.test(a.textContent ?? ''));

describe('Sales history (owner)', () => {
  it('shows the current business date in the title, its sales, and a link to Reports', async () => {
    await sale(TODAY, 10_000);
    await sale(YESTERDAY, 20_000);
    renderAt('/sales');
    expect(await heading()).toHaveTextContent(`Sales — ${en(TODAY)}`);
    await waitFor(() => expect(receipts()).toHaveLength(1));
    expect(screen.getByText('1 sale')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See older in Reports' })).toHaveAttribute(
      'href',
      '/reports/monthly',
    );
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Yesterday and This week (7 days), with the date on each row of a range', async () => {
    // Created oldest first, as in real life (ids follow creation time).
    await sale(TEN_AGO, 40_000);
    await sale(FIVE_AGO, 30_000);
    await sale(YESTERDAY, 20_000);
    await sale(TODAY, 10_000);
    renderAt('/sales');
    fireEvent.click(await screen.findByRole('button', { name: 'Yesterday' }));
    expect(await heading()).toHaveTextContent(`Sales — ${en(YESTERDAY)}`);
    await waitFor(() => expect(receipts()).toHaveLength(1));
    expect(receipts()[0]).toHaveTextContent(/200/);

    fireEvent.click(screen.getByRole('button', { name: 'This week' }));
    await waitFor(() => expect(receipts()).toHaveLength(3));
    expect(await heading()).toHaveTextContent(`Sales — ${en(WEEK_FROM)} to ${en(TODAY)}`);
    // Newest first, each with its date.
    expect(receipts()[0]).toHaveTextContent(en(TODAY));
    expect(receipts()[2]).toHaveTextContent(en(FIVE_AGO));
    expect(screen.getByText('3 sales')).toBeInTheDocument();
  });

  it('Custom: up to 31 days; longer ranges point to Reports', async () => {
    await sale(TEN_AGO, 40_000);
    renderAt('/sales');
    fireEvent.click(await screen.findByRole('button', { name: 'Custom' }));
    const from = screen.getByLabelText('From');
    const to = screen.getByLabelText('To');
    let early = TODAY;
    for (let i = 0; i < 40; i++) early = previousDay(early);
    fireEvent.change(from, { target: { value: early } });
    fireEvent.change(to, { target: { value: TODAY } });
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(
      await screen.findByText('Pick at most 31 days. Older sales are in Reports.'),
    ).toBeInTheDocument();
    fireEvent.change(from, { target: { value: TEN_AGO } });
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(receipts()).toHaveLength(1));
    expect(await heading()).toHaveTextContent(`Sales — ${en(TEN_AGO)} to ${en(TODAY)}`);
  });

  it('opening a sale and going back keeps the range', async () => {
    await sale(YESTERDAY, 20_000);
    renderAt('/sales?range=yesterday');
    await waitFor(() => expect(receipts()).toHaveLength(1));
    fireEvent.click(receipts()[0]!);
    const back = await screen.findByRole('link', { name: 'Back to sales' });
    expect(back).toHaveAttribute('href', '/sales?range=yesterday');
  });

  it('after Day Close the title shows the next day and says where new sales go', async () => {
    const tomorrow = nextDate(TODAY);
    await db.day_closes.put({
      id: '019a9b8e-0000-7000-8000-0000000000f9',
      shop_id: SHOP_ID,
      business_date: TODAY,
      opening_cash_paisa: 0,
      expected_cash_paisa: 0,
      counted_cash_paisa: 0,
      difference_paisa: 0,
      owner_withdrawal_paisa: 0,
      note: null,
      closed_by_staff_id: STAFF_ID,
      closed_at: new Date().toISOString(),
      seen_through_seq: 0,
      device_id: DEVICE_ID,
      server_seq: null,
    });
    await sale(tomorrow, 5_000);
    await sale(TODAY, 10_000);
    renderAt('/sales');
    expect(await heading()).toHaveTextContent(`Sales — ${en(tomorrow)}`);
    expect(screen.getByText(`Day closed — new sales go to ${en(tomorrow)}.`)).toBeInTheDocument();
    await waitFor(() => expect(receipts()).toHaveLength(1));
    // The closed day is one tap away.
    fireEvent.click(screen.getByRole('button', { name: 'Yesterday' }));
    expect(await heading()).toHaveTextContent(`Sales — ${en(TODAY)}`);
  });

  it('reads with every index cursor refused (iOS WebKit, bug 2026-11-25)', async () => {
    const proto = IDBIndex.prototype as unknown as Record<string, unknown>;
    const saved = { openCursor: proto.openCursor, openKeyCursor: proto.openKeyCursor };
    for (const name of ['openCursor', 'openKeyCursor']) {
      proto[name] = () => {
        throw new DOMException('Unable to open cursor', 'UnknownError');
      };
    }
    try {
      await sale(TODAY, 10_000);
      await sale(YESTERDAY, 20_000);
      renderAt('/sales?range=week');
      await waitFor(() => expect(receipts()).toHaveLength(2));
    } finally {
      Object.assign(proto, saved);
    }
  });

  it('Urdu: title, picker and the Reports link', async () => {
    await i18n.changeLanguage('ur');
    await sale(TODAY, 10_000);
    renderAt('/sales');
    expect(await heading()).toHaveTextContent(/^سیل — /);
    expect(screen.getByRole('button', { name: 'یہ ہفتہ' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'پرانی سیل رپورٹس میں دیکھیں' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });
});

describe('Sales (cashier, US018)', () => {
  it('only their own sales of the open business day; no picker, no Reports link', async () => {
    await sale(TODAY, 10_000, CASHIER);
    await sale(TODAY, 15_000, STAFF_ID);
    await sale(YESTERDAY, 20_000, CASHIER);
    await writeCurrentStaffId(CASHIER);
    renderAt('/sales?range=week');
    expect(await heading()).toHaveTextContent(`Sales — ${en(TODAY)}`);
    await waitFor(() => expect(receipts()).toHaveLength(1));
    expect(screen.getByText('Your sales for this business day.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Show sales for' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'See older in Reports' })).not.toBeInTheDocument();
    cleanup();
    renderAt('/sales?from=2026-01-01&to=2026-01-31');
    await waitFor(() => expect(receipts()).toHaveLength(1));
    expect(within(receipts()[0]!).getByText('Rs 100')).toBeInTheDocument();
  });
});
