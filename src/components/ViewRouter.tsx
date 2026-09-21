import React from 'react';
import { CaptureSettings, HistoryItem } from '../types';
import { QuickMenu } from './QuickMenu';
import { UrlBatchModal } from './UrlBatchModal';
import { HistoryDrawer } from './HistoryDrawer';
import { OptionsDrawer } from './OptionsDrawer';
import { MultiSizeModal } from './MultiSizeModal';

export type CurrentView = 'menu' | 'urllist' | 'history' | 'options' | 'multisize';

interface ViewRouterProps {
  view: CurrentView;
  setView: (v: CurrentView) => void;
  settings: CaptureSettings;
  history: HistoryItem[];
  isCapturing: boolean;
  statusMessage: string;
  recentBatchCount: number | null;
  onCaptureFullPage: () => void;
  onCaptureVisible: () => void;
  onCaptureSelection: () => void;
  onCaptureAllTabs: () => void;
  onSaveSettings: (s: CaptureSettings) => void;
  onDeleteHistoryItem: (id: string) => void;
  onClearHistory: () => void;
  onBatchResults: (items: HistoryItem[]) => void;
  onSelectPreview: (item: HistoryItem) => void;
  onDismissBatchBanner: () => void;
  isFullTab?: boolean;
}

/**
 * Single canonical view router shared by both the popup layout and the
 * full-tab gallery layout. Previously each layout duplicated the entire
 * view-switch JSX — now both point here.
 */
export const ViewRouter: React.FC<ViewRouterProps> = ({
  view,
  setView,
  settings,
  history,
  isCapturing,
  statusMessage,
  recentBatchCount,
  onCaptureFullPage,
  onCaptureVisible,
  onCaptureSelection,
  onCaptureAllTabs,
  onSaveSettings,
  onDeleteHistoryItem,
  onClearHistory,
  onBatchResults,
  onSelectPreview,
  onDismissBatchBanner,
  isFullTab = false,
}) => {
  return (
    <>
      {view === 'menu' && (
        <QuickMenu
          onCaptureFullPage={onCaptureFullPage}
          onCaptureVisible={onCaptureVisible}
          onCaptureSelection={onCaptureSelection}
          onCaptureAllTabs={onCaptureAllTabs}
          onOpenUrlBatch={() => setView('urllist')}
          onOpenMultiSize={() => setView('multisize')}
          onOpenHistory={() => setView('history')}
          onOpenOptions={() => setView('options')}
          historyCount={history.length}
          isCapturing={isCapturing}
          activeAction={statusMessage}
        />
      )}

      {view === 'urllist' && (
        <UrlBatchModal
          settings={settings}
          onBack={() => setView('menu')}
          onFinished={onBatchResults}
          onPreview={onSelectPreview}
        />
      )}

      {view === 'multisize' && (
        <MultiSizeModal
          settings={settings}
          onBack={() => setView('menu')}
          onFinished={onBatchResults}
          onPreview={onSelectPreview}
        />
      )}

      {view === 'history' && (
        <HistoryDrawer
          history={history}
          onBack={() => {
            onDismissBatchBanner();
            setView('menu');
          }}
          recentBatchBanner={recentBatchCount}
          onDismissBatchBanner={onDismissBatchBanner}
          onSelectPreview={onSelectPreview}
          onDeleteItem={onDeleteHistoryItem}
          onClearAll={onClearHistory}
          isFullTab={isFullTab}
        />
      )}

      {view === 'options' && (
        <OptionsDrawer
          settings={settings}
          onBack={() => setView('menu')}
          onSave={onSaveSettings}
        />
      )}
    </>
  );
};
