import type { RouteObject } from 'react-router';
import { Gate } from './app/Gate.tsx';
import { HomePage } from './app/HomePage.tsx';
import { NotFoundPage } from './app/NotFoundPage.tsx';
import { RootLayout } from './app/RootLayout.tsx';
import { GoogleCallbackPage } from './features/auth/GoogleCallbackPage.tsx';
import { SignInGate } from './features/auth/SignInGate.tsx';
import { CatalogueLayout } from './features/catalogue/CatalogueLayout.tsx';
import { DeviceModePage } from './features/devices/DeviceModePage.tsx';
import { OwnerPinGate } from './features/pin/OwnerPinGate.tsx';
import { DashboardPage } from './features/reports/DashboardPage.tsx';
import { ExpensesReportPage } from './features/reports/ExpensesReportPage.tsx';
import { MonthlyPage } from './features/reports/MonthlyPage.tsx';
import { ProductsReportPage, StaffReportPage } from './features/reports/ProductsStaffPages.tsx';
import { ReportsLayout } from './features/reports/ReportsLayout.tsx';
import { CategoriesPage } from './features/catalogue/CategoriesPage.tsx';
import { PresetPickerPage } from './features/catalogue/PresetPickerPage.tsx';
import { ProductFormPage } from './features/catalogue/ProductFormPage.tsx';
import { ProductListPage } from './features/catalogue/ProductListPage.tsx';
import { TodaysRatesPage } from './features/catalogue/TodaysRatesPage.tsx';
import { SignInPage } from './features/auth/SignInPage.tsx';
import { SetupPage } from './features/onboarding/SetupPage.tsx';
import { PayPage } from './features/sale/PayPage.tsx';
import { SaleDonePage } from './features/sale/SaleDonePage.tsx';
import { SalePage } from './features/sale/SalePage.tsx';
import { SalesListPage, SaleViewPage } from './features/sale/SalesListPage.tsx';
import { StockPage } from './features/stock/StockPage.tsx';
import { ClosePage } from './features/closing/ClosePage.tsx';
import { CloseHistoryPage, SummaryPage } from './features/closing/SummaryPage.tsx';
import { AddExpensePage } from './features/expenses/AddExpensePage.tsx';
import { ExpenseCategoriesPage } from './features/expenses/ExpenseCategoriesPage.tsx';
import { ExpenseDetailPage, ExpensesPage } from './features/expenses/ExpensesPage.tsx';
import { ShopProfilePage } from './features/settings/ShopProfilePage.tsx';
import { ReceiptPage } from './print/ReceiptPage.tsx';
import { CustomerPage } from './features/khata/CustomerPage.tsx';
import { KhataListPage } from './features/khata/KhataListPage.tsx';
import { DiscountLimitPage } from './features/settings/DiscountLimitPage.tsx';
import { PaymentMethodsPage } from './features/settings/PaymentMethodsPage.tsx';
import { SettingsPage } from './features/settings/SettingsPage.tsx';
import { StaffFormPage } from './features/staff/StaffFormPage.tsx';
import { StaffLayout } from './features/staff/StaffLayout.tsx';
import { StaffListPage } from './features/staff/StaffListPage.tsx';
import { SyncPage } from './features/sync/SyncPage.tsx';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: (
          <Gate state="ready">
            <HomePage />
          </Gate>
        ),
      },
      {
        path: 'sign-in',
        element: (
          <SignInGate>
            <SignInPage />
          </SignInGate>
        ),
      },
      // Not gated: it runs before a session exists and finishes by saving one.
      { path: 'auth/callback', element: <GoogleCallbackPage /> },
      {
        path: 'setup',
        element: (
          <Gate state="setup">
            <SetupPage />
          </Gate>
        ),
      },
      {
        // Anyone switched in can sell: no owner gate.
        path: 'sale',
        element: (
          <Gate state="ready">
            <SalePage />
          </Gate>
        ),
      },
      {
        path: 'sale/pay',
        element: (
          <Gate state="ready">
            <PayPage />
          </Gate>
        ),
      },
      {
        path: 'sale/done/:saleId',
        element: (
          <Gate state="ready">
            <SaleDonePage />
          </Gate>
        ),
      },
      {
        // Owners and cashiers (US041); Adjust balance asks for the owner PIN per action.
        path: 'khata',
        element: (
          <Gate state="ready">
            <KhataListPage />
          </Gate>
        ),
      },
      {
        path: 'khata/:customerId',
        element: (
          <Gate state="ready">
            <CustomerPage />
          </Gate>
        ),
      },
      {
        // Owners see all of today's sales, cashiers their own (US018).
        path: 'sales',
        element: (
          <Gate state="ready">
            <SalesListPage />
          </Gate>
        ),
      },
      {
        path: 'sales/:saleId',
        element: (
          <Gate state="ready">
            <SaleViewPage />
          </Gate>
        ),
      },
      {
        // Daily closing and summaries (US044, US045): owners only.
        path: 'closing',
        element: (
          <Gate state="ready">
            <OwnerPinGate>
              <ClosePage />
            </OwnerPinGate>
          </Gate>
        ),
      },
      {
        path: 'closing/history',
        element: (
          <Gate state="ready">
            <OwnerPinGate>
              <CloseHistoryPage />
            </OwnerPinGate>
          </Gate>
        ),
      },
      {
        path: 'closing/:businessDate',
        element: (
          <Gate state="ready">
            <OwnerPinGate>
              <SummaryPage />
            </OwnerPinGate>
          </Gate>
        ),
      },
      {
        path: 'settings/expense-categories',
        element: (
          <Gate state="ready">
            <OwnerPinGate>
              <ExpenseCategoriesPage />
            </OwnerPinGate>
          </Gate>
        ),
      },
      {
        // Owners and cashiers (US046); riders are refused on the page. Reverse asks for the owner.
        path: 'expenses',
        element: (
          <Gate state="ready">
            <ExpensesPage />
          </Gate>
        ),
      },
      {
        path: 'expenses/new',
        element: (
          <Gate state="ready">
            <AddExpensePage />
          </Gate>
        ),
      },
      {
        path: 'expenses/:expenseId',
        element: (
          <Gate state="ready">
            <ExpenseDetailPage />
          </Gate>
        ),
      },
      {
        path: 'settings/shop',
        element: (
          <Gate state="ready">
            <OwnerPinGate>
              <ShopProfilePage />
            </OwnerPinGate>
          </Gate>
        ),
      },
      {
        // Receipt preview, share and print (US036); also reprints from Today's sales.
        path: 'receipt/:saleId',
        element: (
          <Gate state="ready">
            <ReceiptPage />
          </Gate>
        ),
      },
      {
        path: 'settings/discount-limit',
        element: (
          <Gate state="ready">
            <OwnerPinGate>
              <DiscountLimitPage />
            </OwnerPinGate>
          </Gate>
        ),
      },
      {
        path: 'settings/payment-methods',
        element: (
          <Gate state="ready">
            <OwnerPinGate>
              <PaymentMethodsPage />
            </OwnerPinGate>
          </Gate>
        ),
      },
      {
        path: 'sync',
        element: (
          <Gate state="ready">
            <SyncPage />
          </Gate>
        ),
      },
      {
        path: 'settings',
        element: (
          <Gate state="ready">
            <SettingsPage />
          </Gate>
        ),
      },
      {
        // Owner screen (manage_devices): owner PIN on shop devices.
        path: 'settings/device',
        element: (
          <Gate state="ready">
            <OwnerPinGate>
              <DeviceModePage />
            </OwnerPinGate>
          </Gate>
        ),
      },
      {
        // Owner screens: one owner check per visit (OwnerPinGate in StaffLayout).
        path: 'staff',
        element: (
          <Gate state="ready">
            <StaffLayout />
          </Gate>
        ),
        children: [
          { index: true, element: <StaffListPage /> },
          { path: 'new', element: <StaffFormPage /> },
          { path: ':staffId', element: <StaffFormPage /> },
        ],
      },
      {
        // Owners and cashiers (wastage); Stock in and Set stock ask for the owner PIN per action.
        path: 'stock',
        element: (
          <Gate state="ready">
            <StockPage />
          </Gate>
        ),
      },
      {
        // Owner screens (manage_products): one owner check per visit (OwnerPinGate).
        path: 'products',
        element: (
          <Gate state="ready">
            <CatalogueLayout />
          </Gate>
        ),
        children: [
          { index: true, element: <ProductListPage /> },
          { path: 'new', element: <ProductFormPage /> },
          { path: 'categories', element: <CategoriesPage /> },
          { path: 'presets', element: <PresetPickerPage /> },
          { path: 'rates', element: <TodaysRatesPage /> },
          { path: ':productId', element: <ProductFormPage /> },
        ],
      },
      {
        // Owner reports (US047–US049, US068): owners only, from the server; the owner PIN on shop
        // devices (OwnerPinGate), cached for offline viewing only on owner devices (reportsData.ts).
        path: 'reports',
        element: (
          <Gate state="ready">
            <OwnerPinGate>
              <ReportsLayout />
            </OwnerPinGate>
          </Gate>
        ),
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'monthly', element: <MonthlyPage /> },
          { path: 'products', element: <ProductsReportPage /> },
          { path: 'staff', element: <StaffReportPage /> },
          { path: 'expenses', element: <ExpensesReportPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
