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
        <SocraticChat
          articleId={articleId}
          articleTitle={articleTitle}
          initialQuestion={question}
          onClose={onClose}
          onBack={onClose}
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
});

export default SocraticQAModal;
