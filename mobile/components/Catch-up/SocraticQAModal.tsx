import React from 'react';
import { Modal, View, StyleSheet, Platform } from 'react-native';
import { SocraticChat } from '../Reader/SocraticChat';

interface SocraticQAModalProps {
  visible: boolean;
  onClose: () => void;
  question: string;
  articleId: string;
  articleTitle: string;
  isDark?: boolean;
}

/**
 * SocraticQAModal - Wrapper modal that opens the Guru Q&A chat directly.
 * Uses a semi-transparent blurred backdrop instead of opaque dark background.
 */
const SocraticQAModal: React.FC<SocraticQAModalProps> = ({
  visible,
  onClose,
  question,
  articleId,
  articleTitle,
}) => {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={[
        styles.backdrop,
        Platform.OS === 'web' && {
          // @ts-ignore
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        } as any,
      ]}>
        {/* RN Modal portals to the document root, escaping the app's 480px
            web shell (ThemeAwareNav) — re-apply the same column here so the
            chat matches the mobile-optimized experience (R20 follow-up). */}
        <View style={styles.shellColumn}>
          <SocraticChat
            articleId={articleId}
            articleTitle={articleTitle}
            initialQuestion={question}
            onClose={onClose}
            onBack={onClose}
          />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  // Mirror of the app shell constraint in ThemeAwareNav — keep in sync.
  shellColumn: Platform.OS === 'web'
    ? { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center' }
    : { flex: 1 },
});

export default SocraticQAModal;
